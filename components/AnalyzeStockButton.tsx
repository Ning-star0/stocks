"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Brain } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingInsight } from "@/components/ui/layout";
import { readJsonResponse } from "@/lib/clientApi";

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
      const json = await readJsonResponse<{ fromCache?: boolean; jobId?: string }>(response);

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
          <Brain className="h-4 w-4" />
          {buttonText(status)}
        </Button>
        <Button variant="outline" onClick={() => analyze(true)} disabled={isBusy}>
          强制刷新
        </Button>
      </div>
      {isBusy ? (
        <div className="w-full max-w-sm">
          <LoadingInsight text={`${thinkingMessage(elapsed)}（${formatElapsed(elapsed)}）`} activeStepIndex={thinkingStepIndex(elapsed)} />
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
    const json = await readJsonResponse<{ status?: string; errorMessage?: string }>(response);
    if (json.status === "completed" || json.status === "skipped_cached") return;
    if (json.status === "failed") throw new Error(json.errorMessage ?? "分析任务失败。");
  }
}

function thinkingMessage(elapsed: number) {
  if (elapsed < 8) return "正在读取行情数据";
  if (elapsed < 20) return "正在分析技术指标";
  if (elapsed < 45) return "正在综合新闻情绪";
  if (elapsed < 120) return "正在生成策略观察";
  return "数据量较大，仍在稳妥处理中";
}

function thinkingStepIndex(elapsed: number) {
  if (elapsed < 8) return 0;
  if (elapsed < 20) return 1;
  if (elapsed < 45) return 2;
  return 3;
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
