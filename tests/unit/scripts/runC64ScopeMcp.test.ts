import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve(process.cwd(), "c64scope/scripts/start.mjs");
const tempDirs: string[] = [];

const createTempDir = (prefix: string) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
};

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe("run-c64scope-mcp", () => {
    it("bootstraps c64scope dependencies before launching on a fresh checkout", () => {
        const scopeDir = createTempDir("run-c64scope-mcp-");
        const binDir = path.join(scopeDir, "bin");
        const logPath = path.join(scopeDir, "npm-invocations.log");

        mkdirSync(path.join(scopeDir, "src"), { recursive: true });
        mkdirSync(binDir, { recursive: true });

        writeFileSync(
            path.join(scopeDir, "package.json"),
            JSON.stringify({ name: "c64scope", private: true }, null, 2),
            "utf8",
        );
        writeFileSync(path.join(scopeDir, "src", "index.ts"), 'console.log("scope started");\n', "utf8");

        const fakeNpmPath = path.join(binDir, "npm");
        writeFileSync(
            fakeNpmPath,
            `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "${logPath}"
if [ "$1" = "install" ]; then
  mkdir -p "${scopeDir}/node_modules/@modelcontextprotocol/sdk" "${scopeDir}/node_modules/tsx"
  printf '{"name":"@modelcontextprotocol/sdk"}\n' > "${scopeDir}/node_modules/@modelcontextprotocol/sdk/package.json"
  printf '{"name":"tsx"}\n' > "${scopeDir}/node_modules/tsx/package.json"
  exit 0
fi
if [ "$1" = "exec" ]; then
  exit 0
fi
exit 1
`,
            "utf8",
        );
        chmodSync(fakeNpmPath, 0o755);

        const result = spawnSync(process.execPath, [scriptPath], {
            cwd: process.cwd(),
            encoding: "utf8",
            env: {
                ...process.env,
                C64SCOPE_DIR: scopeDir,
                PATH: `${binDir}:${process.env.PATH ?? ""}`,
            },
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual(["install", "exec tsx src/index.ts"]);
    });
});
