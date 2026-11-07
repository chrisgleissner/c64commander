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

export const resolveScopeDir = (env = process.env) => {
    if (env.C64SCOPE_DIR) {
        return path.resolve(env.C64SCOPE_DIR);
    }

    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
};

const ensureScopePackageExists = (scopeDir) => {
    if (!existsSync(path.join(scopeDir, "package.json"))) {
        throw new Error(`Unable to locate c64scope package at ${scopeDir}`);
    }
};

export const runC64ScopeMcp = (env = process.env) => {
    const scopeDir = resolveScopeDir(env);

    ensureScopePackageExists(scopeDir);
    ensureRuntimeDependencies({
        packageDir: scopeDir,
        label: "c64scope",
        requiredPackages: REQUIRED_RUNTIME_PACKAGES,
        env,
    });

    const child = spawn("npm", ["exec", "tsx", "src/index.ts"], {
        cwd: scopeDir,
        env,
        stdio: "inherit",
    });

    child.on("error", (error) => {
        console.error(`Failed to start c64scope MCP server: ${error.stack ?? error.message}`);
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
        runC64ScopeMcp();
    } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.error(message);
        process.exit(1);
    }
}
