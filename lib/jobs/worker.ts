import { checkFocusSchedules } from "@/lib/focus/scheduler";
import { processNextJob } from "@/lib/jobs/processNextJob";

export async function startWorker(options: { signal?: AbortSignal } = {}) {
  const enabled = process.env.ENABLE_BACKGROUND_WORKER !== "false";
  if (!enabled) return;

  const intervalMs = numberEnv("JOB_POLL_INTERVAL_MS", 5000);
  const maxConcurrent = clamp(numberEnv("MAX_CONCURRENT_JOBS", 3), 1, 8);
  const activeJobs = new Set<Promise<void>>();
  let lastScheduleCheck = Date.now(); // 启动后等 60s 再首次调度检查
  let scheduleCheckRunning = false;

  while (!options.signal?.aborted) {
    let workPickedUp = false;
    while (activeJobs.size < maxConcurrent) {
      const task = processNextJob()
        .then((job) => {
          if (job) workPickedUp = true;
        })
        .catch(() => {})
        .finally(() => {
          activeJobs.delete(task);
        });
      activeJobs.add(task);
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

    // 等待任一任务完成或超时
    await Promise.race([...activeJobs, sleep(intervalMs)]);

    // 本轮没有实际任务时，等待 intervalMs 再继续，避免空轮询吃满 CPU
    if (!workPickedUp && activeJobs.size === 0) {
      await sleep(intervalMs);
    }
  }

  await Promise.allSettled(activeJobs);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
