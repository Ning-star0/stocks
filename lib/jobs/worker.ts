import { checkFocusSchedules } from "@/lib/focus/scheduler";
import { processNextJob } from "@/lib/jobs/processNextJob";

export async function startWorker(options: { signal?: AbortSignal } = {}) {
  const enabled = process.env.ENABLE_BACKGROUND_WORKER !== "false";
  if (!enabled) return;

  const intervalMs = numberEnv("JOB_POLL_INTERVAL_MS", 5000);
  const maxConcurrent = Math.min(1, numberEnv("MAX_CONCURRENT_JOBS", 1));
  let running = 0;
  let lastScheduleCheck = 0;
  let scheduleCheckRunning = false;

  while (!options.signal?.aborted) {
    if (running < maxConcurrent) {
      running += 1;
      await processNextJob().finally(() => {
        running -= 1;
      });
    }

    // 每 60 秒检查一次关注板块的定时任务
    const now = Date.now();
    if (!scheduleCheckRunning && now - lastScheduleCheck >= 60_000) {
      lastScheduleCheck = now;
      scheduleCheckRunning = true;
      checkFocusSchedules()
        .catch(() => {})
        .finally(() => {
          scheduleCheckRunning = false;
        });
    }

    await sleep(intervalMs);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
