#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export const hasScopeRuntimeDependencies = (scopeDir) =>
    REQUIRED_RUNTIME_PACKAGES.every((segments) => existsSync(path.join(scopeDir, ...segments)));

const ensureScopePackageExists = (scopeDir) => {
    if (!existsSync(path.join(scopeDir, "package.json"))) {
        throw new Error(`Unable to locate c64scope package at ${scopeDir}`);
    }
};

const ensureScopeDependencies = (scopeDir, env) => {
    if (hasScopeRuntimeDependencies(scopeDir)) {
        return;
    }

    const installResult = spawnSync("npm", ["install"], {
        cwd: scopeDir,
        env,
        stdio: "inherit",
    });

    if (installResult.error) {
        throw new Error(`Failed to install c64scope dependencies: ${installResult.error.message}`);
    }

    if (installResult.status !== 0) {
        throw new Error(`c64scope dependency install exited with status ${installResult.status ?? 1}`);
    }

    if (!hasScopeRuntimeDependencies(scopeDir)) {
        throw new Error("c64scope dependencies are still missing after npm install");
    }
};

export const runC64ScopeMcp = (env = process.env) => {
    const scopeDir = resolveScopeDir(env);

    ensureScopePackageExists(scopeDir);
    ensureScopeDependencies(scopeDir, env);

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
