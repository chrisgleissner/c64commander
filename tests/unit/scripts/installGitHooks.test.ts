import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.resolve(process.cwd(), "scripts/install-git-hooks.mjs");
const packageJsonPath = path.resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  scripts?: Record<string, string>;
};
const postinstallCommand = packageJson.scripts?.postinstall ?? "";

const runScript = (cwd: string, env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, [scriptPath], {
    cwd,
    env,
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
  const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  it.each(["/custom/hook-guard", ".githooks", ""])("preserves the explicitly configured hook path %j", (hooksPath) => {
    const root = createTempDir("install-git-hooks-custom-");
    git(root, ["init"]);
    git(root, ["config", "core.hooksPath", hooksPath]);

    expect(runScript(root).status).toBe(0);

    expect(git(root, ["config", "--get", "core.hooksPath"])).toBe(hooksPath);
  });

  it("preserves an inherited global hook path without adding a local override", () => {
    const root = createTempDir("install-git-hooks-global-");
    const globalConfig = path.join(root, "global.gitconfig");
    writeFileSync(globalConfig, "[core]\n hooksPath = /global/hook-guard\n");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
    git(root, ["init"], env);

    expect(runScript(root, env).status).toBe(0);

    expect(git(root, ["config", "--get", "core.hooksPath"], env)).toBe("/global/hook-guard");
    expect(spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: root, env }).status).toBe(1);
  });

  it("does not replace the shared hook path when installing from a linked worktree", () => {
    const root = createTempDir("install-git-hooks-linked-");
    git(root, ["init"]);
    git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    ]);
    const linked = path.join(root, "linked");
    git(root, ["worktree", "add", "--detach", linked]);
    git(root, ["config", "core.hooksPath", "/shared/hook-guard"]);

    expect(runScript(linked).status).toBe(0);

    expect(git(root, ["config", "--get", "core.hooksPath"])).toBe("/shared/hook-guard");
    expect(git(linked, ["config", "--get", "core.hooksPath"])).toBe("/shared/hook-guard");
  });

  it("reports a hook configuration read failure instead of overwriting the configuration", () => {
    const root = createTempDir("install-git-hooks-read-error-");
    mkdirSync(path.join(root, ".git"));
    const binDir = path.join(root, "bin");
    mkdirSync(binDir);
    const gitStub = path.join(binDir, "git");
    writeFileSync(
      gitStub,
      `#!/bin/sh
if [ "$1" = rev-parse ]; then exit 0; fi
if [ "$1" = config ] && [ "$2" = --get ]; then
  printf '%s\\n' 'cannot read hook config' >&2
  exit 2
fi
printf '%s\\n' 'unexpected hook configuration write' >&2
exit 99
`,
    );
    chmodSync(gitStub, 0o755);

    const result = runScript(root, { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`Could not inspect Git hook configuration in ${root}`);
    expect(result.stderr).toContain("cannot read hook config");
    expect(result.stderr).not.toContain("unexpected hook configuration write");
  });

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

  it("package postinstall succeeds when git hook installer is absent in a minimal context", () => {
    const root = createTempDir("postinstall-minimal-context-");
    const binDir = path.join(root, "bin");
    mkdirSync(binDir, { recursive: true });

    const patchPackageStub = path.join(binDir, "patch-package");
    writeFileSync(patchPackageStub, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(patchPackageStub, 0o755);

    const result = spawnSync("sh", ["-c", postinstallCommand], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    expect(postinstallCommand).toContain("existsSync('./scripts/install-git-hooks.mjs')");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
