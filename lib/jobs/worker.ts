import { checkFocusSchedules } from "@/lib/focus/scheduler";
import { JOB_STATUS } from "@/lib/jobs/jobTypes";
import { processNextJob } from "@/lib/jobs/processNextJob";

export async function startWorker(options: { signal?: AbortSignal } = {}) {
  const enabled = process.env.ENABLE_BACKGROUND_WORKER !== "false";
  if (!enabled) return;

  const intervalMs = numberEnv("JOB_POLL_INTERVAL_MS", 5000);
  const requeueDelayMs = numberEnv("JOB_REQUEUE_DELAY_MS", intervalMs);
  const scheduleIntervalMs = numberEnv("FOCUS_SCHEDULE_CHECK_INTERVAL_MS", 60_000);
  const scheduleInitialDelayMs = numberEnv("FOCUS_SCHEDULE_INITIAL_DELAY_MS", 1000);
  const workerLimit = clamp(numberEnv("MAX_CONCURRENT_JOBS", 3), 1, 8);

  const loops = [
    runScheduleLoop({ intervalMs: scheduleIntervalMs, initialDelayMs: scheduleInitialDelayMs, signal: options.signal }),
    ...Array.from({ length: workerLimit }, (_, index) => runJobLoop({ index, intervalMs, requeueDelayMs, signal: options.signal }))
  ];

  await Promise.all(loops);
}

async function runJobLoop(input: { index: number; intervalMs: number; requeueDelayMs: number; signal?: AbortSignal }) {
  while (!input.signal?.aborted) {
    const job = await processNextJob().catch((error) => {
      console.error(`[worker:${input.index}] process job failed`, error);
      return null;
    });

    if (!job) {
      await sleep(input.intervalMs, input.signal);
      continue;
    }

    // 等待型任务会把自己重新放回 queued；这里必须退避，避免反复抢同一个任务打满 CPU。
    if (job.status === JOB_STATUS.QUEUED) {
      await sleep(input.requeueDelayMs, input.signal);
    }
  }
}

async function runScheduleLoop(input: { intervalMs: number; initialDelayMs: number; signal?: AbortSignal }) {
  await sleep(input.initialDelayMs, input.signal);

  while (!input.signal?.aborted) {
    const startedAt = Date.now();
    await checkFocusSchedules().catch((error) => {
      console.error("[worker:scheduler] schedule check failed", error);
    });

    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(1000, input.intervalMs - elapsed), input.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, ms);
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
