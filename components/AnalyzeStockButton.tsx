"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type JobStatus = "idle" | "cached" | "queued" | "running" | "completed" | "failed";

export function AnalyzeStockButton({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startTimer() {
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((prev) => prev + 1), 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function analyze(forceRefresh = false) {
    setError(null);
    setStatus("queued");
    startTimer();
    try {
      const response = await fetch(`/api/stocks/${symbol}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRefresh })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "创建分析任务失败。");

      if (json.fromCache && !json.jobId) {
        stopTimer();
        setStatus("cached");
        router.refresh();
        return;
      }

      if (json.jobId) {
        setStatus("running");
        await pollJob(json.jobId);
        stopTimer();
        setStatus("completed");
        router.refresh();
        return;
      }

      stopTimer();
      setStatus("completed");
      router.refresh();
    } catch (analysisError) {
      stopTimer();
      setStatus("failed");
      setError(analysisError instanceof Error ? analysisError.message : "创建分析任务失败。");
    }
  }

  const isBusy = status === "queued" || status === "running";

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <div className="flex gap-2">
        <Button onClick={() => analyze(false)} disabled={isBusy}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          {buttonText(status)}
        </Button>
        <Button variant="outline" onClick={() => analyze(true)} disabled={isBusy}>
          强制刷新
        </Button>
      </div>
      {isBusy ? (
        <div className="max-w-sm space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
              <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: "0ms" }} />
              <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: "150ms" }} />
              <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: "300ms" }} />
            </span>
            <span>{thinkingMessage(elapsed)}</span>
            <span className="tabular-nums">({formatElapsed(elapsed)})</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full animate-pulse rounded-full bg-blue-500/50" style={{ width: `${Math.min(elapsed * 2, 90)}%` }} />
          </div>
        </div>
      ) : null}
      {status === "completed" ? (
        <div className="max-w-sm text-xs text-emerald-400">分析完成，结果已展示在下方。</div>
      ) : null}
      {status === "cached" ? (
        <div className="max-w-sm text-xs text-muted-foreground">当前上下文未变化，已复用缓存分析。</div>
      ) : null}
      {status === "failed" ? (
        <div className="max-w-sm text-xs text-red-400">{error || "分析失败，可重试。"}</div>
      ) : null}
    </div>
  );
}

async function pollJob(jobId: string) {
  for (let i = 0; i < 120; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "查询任务状态失败。");
    if (json.status === "completed" || json.status === "skipped_cached") return;
    if (json.status === "failed") throw new Error(json.errorMessage ?? "分析任务失败。");
  }
}

function thinkingMessage(elapsed: number) {
  if (elapsed < 10) return "正在获取数据并进行分析...";
  if (elapsed < 30) return "AI 正在综合技术面、新闻和行业催化...";
  if (elapsed < 60) return "模型深度推理中，请耐心等待...";
  if (elapsed < 120) return "分析即将完成...";
  return "数据量较大，仍在处理中...";
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s.toString().padStart(2, "0")}秒` : `${s}秒`;
}

function buttonText(status: JobStatus) {
  if (status === "queued") return "排队中...";
  if (status === "running") return "分析中...";
  if (status === "completed") return "查看结果";
  if (status === "failed") return "失败，重试";
  if (status === "cached") return "缓存有效";
  return "AI 分析";
}
