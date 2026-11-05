/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const hook = path.resolve(__dirname, "../../../.githooks/pre-push");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });

describe(".githooks/pre-push", () => {
  let root: string;

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const repoWithRefusingLocalHook = () => {
    root = mkdtempSync(path.join(tmpdir(), "pre-push-"));
    const main = path.join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const localHook = path.join(main, ".git", "local-hooks", "pre-push");
    mkdirSync(path.dirname(localHook));
    writeFileSync(localHook, "#!/bin/sh\necho refused >&2\nexit 7\n");
    chmodSync(localHook, 0o755);
    return main;
  };

  it("runs the machine-local hook from the main checkout", () => {
    const main = repoWithRefusingLocalHook();
    const result = spawnSync("sh", [hook], { cwd: main, input: "" });
    expect(result.status).toBe(7);
  });

  it("runs the same machine-local hook from a linked worktree", () => {
    const main = repoWithRefusingLocalHook();
    const worktree = path.join(root, "wt");
    git(main, "worktree", "add", "-q", worktree);
    const result = spawnSync("sh", [hook], { cwd: worktree, input: "" });
    expect(result.status).toBe(7);
    expect(result.stderr.toString()).toContain("refused");
  });
});
