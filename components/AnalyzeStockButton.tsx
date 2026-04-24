"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain } from "lucide-react";

import { Button } from "@/components/ui/button";

type JobStatus = "idle" | "cached" | "queued" | "running" | "completed" | "failed";

export function AnalyzeStockButton({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function analyze(forceRefresh = false) {
    setError(null);
    setStatus("queued");
    try {
      const response = await fetch(`/api/stocks/${symbol}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceRefresh })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message ?? "创建分析任务失败。");

      if (json.fromCache && !json.jobId) {
        setStatus("cached");
        router.refresh();
        return;
      }

      if (json.jobId) {
        await pollJob(json.jobId, setStatus);
        router.refresh();
        return;
      }

      setStatus("completed");
      router.refresh();
    } catch (analysisError) {
      setStatus("failed");
      setError(analysisError instanceof Error ? analysisError.message : "创建分析任务失败。");
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 md:items-end">
      <div className="flex gap-2">
        <Button onClick={() => analyze(false)} disabled={status === "queued" || status === "running"}>
          <Brain className="h-4 w-4" />
          {buttonText(status)}
        </Button>
        <Button variant="outline" onClick={() => analyze(true)} disabled={status === "queued" || status === "running"}>
          强制刷新
        </Button>
      </div>
      {status !== "idle" ? <div className="max-w-sm text-xs text-muted-foreground">{statusText(status)}</div> : null}
      {error ? <div className="max-w-sm text-xs text-red-400">{error}</div> : null}
    </div>
  );
}

async function pollJob(jobId: string, setStatus: (status: JobStatus) => void) {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "查询任务状态失败。");
    if (json.status === "running") setStatus("running");
    if (json.status === "completed" || json.status === "skipped_cached") {
      setStatus("completed");
      return;
    }
    if (json.status === "failed") throw new Error(json.errorMessage ?? "分析任务失败。");
  }
}

function buttonText(status: JobStatus) {
  if (status === "queued") return "排队中";
  if (status === "running") return "分析中";
  if (status === "completed") return "查看结果";
  if (status === "failed") return "失败，重试";
  if (status === "cached") return "缓存有效";
  return "分析";
}

function statusText(status: JobStatus) {
  if (status === "queued") return "任务已加入队列。";
  if (status === "running") return "后台正在分析。";
  if (status === "completed") return "分析完成。";
  if (status === "failed") return "分析失败，可重试。";
  if (status === "cached") return "当前上下文未变化，已复用缓存分析。";
  return "";
}
