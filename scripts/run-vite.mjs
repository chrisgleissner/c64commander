import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const ignoredConfigDir = path.join(repoRoot, ".tmp");
const ignoredConfigPath = path.join(ignoredConfigDir, "vite.config.ts");

await mkdir(ignoredConfigDir, { recursive: true });
await writeFile(ignoredConfigPath, "export { default } from '../vite.config.ts';\n", "utf8");

const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const viteArgs = [...process.argv.slice(2), "--config", ignoredConfigPath];
const child = spawn(process.execPath, [viteBin, ...viteArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
