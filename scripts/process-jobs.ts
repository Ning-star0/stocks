import { setDefaultResultOrder } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

setDefaultResultOrder("ipv4first");
loadDotEnv();

async function main() {
  const [{ processNextJob }, { prisma }] = await Promise.all([import("@/lib/jobs/processNextJob"), import("@/lib/prisma")]);
  const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 5);
  const processed = [];
  for (let i = 0; i < limit; i += 1) {
    const job = await processNextJob();
    if (!job) break;
    processed.push(job);
  }
  console.log(JSON.stringify({ processed: processed.length, jobs: processed.map((job) => ({ id: job.id, status: job.status, resultId: job.resultId })) }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[process-jobs] fatal", error);
  process.exitCode = 1;
});

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
