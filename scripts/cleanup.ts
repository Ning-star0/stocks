import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

async function main() {
  const [{ cleanupRetention }, { prisma }] = await Promise.all([import("@/lib/maintenance/cleanup"), import("@/lib/prisma")]);
  const result = await cleanupRetention();
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[cleanup] fatal", error);
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

