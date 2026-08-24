import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, ["--dns-result-order=ipv4first", nextCli, "build"], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit"
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

copyDirectory(
  path.join(projectRoot, ".next", "static"),
  path.join(projectRoot, ".next", "standalone", ".next", "static")
);
copyDirectory(path.join(projectRoot, "public"), path.join(projectRoot, ".next", "standalone", "public"));

function copyDirectory(source, destination) {
  if (!existsSync(source)) return;
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}
