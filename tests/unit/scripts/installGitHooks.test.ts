import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = path.resolve(process.cwd(), "scripts/install-git-hooks.mjs");

const runScript = (cwd: string) =>
    spawnSync(process.execPath, [scriptPath], {
        cwd,
        env: process.env,
        encoding: "utf8",
    });

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

describe("install-git-hooks", () => {
    it("exits successfully when no .git path exists", () => {
        const root = createTempDir("install-git-hooks-no-git-");

        const result = runScript(root);

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
    });

    it("exits successfully when .git exists but cwd is not a usable git worktree", () => {
        const root = createTempDir("install-git-hooks-detached-");
        writeFileSync(path.join(root, ".git"), "gitdir: /missing/worktree\n", "utf8");

        const result = runScript(root);

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
    });

    it("configures core.hooksPath inside a real git worktree", () => {
        const root = createTempDir("install-git-hooks-repo-");
        mkdirSync(path.join(root, ".githooks"), { recursive: true });

        const initResult = spawnSync("git", ["init"], {
            cwd: root,
            encoding: "utf8",
        });
        expect(initResult.status).toBe(0);

        const result = runScript(root);
        expect(result.status).toBe(0);

        const configResult = spawnSync("git", ["config", "--get", "core.hooksPath"], {
            cwd: root,
            encoding: "utf8",
        });

        expect(configResult.status).toBe(0);
        expect(configResult.stdout.trim()).toBe(".githooks");
    });
});
