import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const DB_TEST_FILES = [
  "tests/apiQuotaDb.test.ts",
  "tests/analysisPersistenceDb.test.ts",
  "tests/shadowForecastDb.test.ts"
];

async function main() {
  const baseDatabaseUrl = process.env.DATABASE_URL || await readEnvValue("DATABASE_URL");
  if (!baseDatabaseUrl) throw new Error("缺少 DATABASE_URL，无法创建隔离数据库测试 schema。");

  const schema = `codex_e2e_${Date.now()}_${randomBytes(4).toString("hex")}`;
  if (!/^codex_e2e_[a-z0-9_]+$/.test(schema)) throw new Error("隔离 schema 名称校验失败。");
  const isolatedDatabaseUrl = withSchema(baseDatabaseUrl, schema);
  const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
  let schemaCreated = false;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    console.log(`[db-e2e] 已创建隔离 schema：${schema}`);

    await runCommand("prisma", ["migrate", "deploy"], {
      DATABASE_URL: isolatedDatabaseUrl
    });
    await runCommand("tsx", ["--test", ...DB_TEST_FILES], {
      DATABASE_URL: isolatedDatabaseUrl,
      RUN_DB_E2E_TESTS: "true",
      NODE_ENV: "test"
    });
  } finally {
    if (schemaCreated) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      console.log(`[db-e2e] 已清理隔离 schema：${schema}`);
    }
    await admin.$disconnect();
  }
}

async function runCommand(binary: "prisma" | "tsx", args: string[], extraEnv: Record<string, string>) {
  const executable = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${binary}.cmd` : binary
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} ${args.join(" ")} 执行失败（code=${code ?? "null"}, signal=${signal ?? "none"}）。`));
    });
  });
}

function withSchema(databaseUrl: string, schema: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("隔离数据库测试只支持 PostgreSQL DATABASE_URL。");
  }
  url.searchParams.set("schema", schema);
  return url.toString();
}

async function readEnvValue(key: string) {
  const file = await readFile(path.join(process.cwd(), ".env"), "utf8").catch(() => "");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== key) continue;
    const value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }
  return null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
