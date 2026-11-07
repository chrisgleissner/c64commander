#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRuntimeDependencies } from "../../scripts/mcp-runtime-dependencies.mjs";

const REQUIRED_RUNTIME_PACKAGES = [
  ["node_modules", "@modelcontextprotocol", "sdk", "package.json"],
  ["node_modules", "tsx", "package.json"],
];

export const resolveDroidctlDir = (env = process.env) => {
  if (env.DROIDCTL_DIR) {
    return path.resolve(env.DROIDCTL_DIR);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
};

const ensureDroidctlPackageExists = (droidctlDir) => {
  if (!existsSync(path.join(droidctlDir, "package.json"))) {
    throw new Error(`Unable to locate droidctl package at ${droidctlDir}`);
  }
};

export const runDroidctlMcp = (env = process.env) => {
  const droidctlDir = resolveDroidctlDir(env);

  ensureDroidctlPackageExists(droidctlDir);
  ensureRuntimeDependencies({
    packageDir: droidctlDir,
    label: "droidctl",
    requiredPackages: REQUIRED_RUNTIME_PACKAGES,
    env,
  });

  const child = spawn("npm", ["exec", "tsx", "src/index.ts"], {
    cwd: droidctlDir,
    env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`Failed to start droidctl MCP server: ${error.stack ?? error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  for (const forwardedSignal of ["SIGINT", "SIGTERM"]) {
    process.on(forwardedSignal, () => {
      if (!child.killed) {
        child.kill(forwardedSignal);
      }
    });
  }

  return child;
};

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentFile = fileURLToPath(import.meta.url);

if (entrypoint === currentFile) {
  try {
    runDroidctlMcp();
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exit(1);
  }
}
