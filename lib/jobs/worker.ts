import { checkFocusSchedules } from "@/lib/focus/scheduler";
import { processNextJob } from "@/lib/jobs/processNextJob";

export async function startWorker(options: { signal?: AbortSignal } = {}) {
  const enabled = process.env.ENABLE_BACKGROUND_WORKER !== "false";
  if (!enabled) return;

  const intervalMs = numberEnv("JOB_POLL_INTERVAL_MS", 5000);
  let lastScheduleCheck = Date.now(); // 启动后等 60s 再首次调度检查

  while (!options.signal?.aborted) {
    const job = await processNextJob().catch(() => null);
    if (job) continue; // 有任务就持续处理，不 sleep

    // 每 60 秒检查一次关注板块的定时任务
    const now = Date.now();
    if (now - lastScheduleCheck >= 60_000) {
      lastScheduleCheck = now;
      checkFocusSchedules().catch(() => {});
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

