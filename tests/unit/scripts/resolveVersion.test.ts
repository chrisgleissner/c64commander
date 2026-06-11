import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDirs: string[] = [];
const sourceScriptPath = path.resolve(process.cwd(), "scripts/resolve-version.sh");
const sourceBuildVersionScriptPath = path.resolve(process.cwd(), "scripts/resolve-build-version.mjs");

const withoutInjectedVersions = () => ({
  ...process.env,
  APP_VERSION: "",
  GITHUB_REF: "",
  GITHUB_REF_NAME: "",
  GITHUB_REF_TYPE: "",
  VERSION_NAME: "",
  VITE_APP_VERSION: "",
});

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

describe("resolve-version.sh", () => {
  it("falls back to package.json when run outside a git checkout", () => {
    const repoDir = createTempDir("resolve-version-no-git-");
    const scriptsDir = path.join(repoDir, "scripts");
    const srcDir = path.join(repoDir, "src");
    const scriptPath = path.join(scriptsDir, "resolve-version.sh");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });

    copyFileSync(sourceScriptPath, scriptPath);
    chmodSync(scriptPath, 0o755);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-version-fixture", version: "1.2.3" }, null, 2),
      "utf8",
    );

    const result = spawnSync("bash", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: process.env,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3");
    expect(readFileSync(path.join(srcDir, "version.ts"), "utf8")).toBe("export const APP_VERSION = '1.2.3';\n");
  });

  it("truncates git's minimum-length short sha output to exactly five characters", () => {
    const repoDir = createTempDir("resolve-version-");
    const scriptsDir = path.join(repoDir, "scripts");
    const srcDir = path.join(repoDir, "src");
    const binDir = path.join(repoDir, "bin");
    const scriptPath = path.join(scriptsDir, "resolve-version.sh");
    const fakeGitPath = path.join(binDir, "git");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    copyFileSync(sourceScriptPath, scriptPath);
    chmodSync(scriptPath, 0o755);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-version-fixture", version: "1.2.3" }, null, 2),
      "utf8",
    );

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
set -eu
case "$*" in
  "rev-parse --show-toplevel") printf '%s\n' "$PWD" ;;
  "ls-files --error-unmatch src/version.ts") exit 1 ;;
  "fetch --tags --quiet") exit 0 ;;
  "describe --tags --abbrev=0") printf '1.2.3\n' ;;
  "rev-parse HEAD") printf 'abc123def4567890abc123def4567890abc123de\n' ;;
  "diff --quiet HEAD --") exit 1 ;;
  *)
    printf 'unexpected git invocation: %s\n' "$*" >&2
    exit 2
    ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGitPath, 0o755);

    const result = spawnSync("bash", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3-abc12");
    expect(readFileSync(path.join(srcDir, "version.ts"), "utf8")).toBe("export const APP_VERSION = '1.2.3-abc12';\n");
  });

  it("includes the commit id for a clean checkout ahead of the latest git tag", () => {
    const repoDir = createTempDir("resolve-version-ahead-");
    const scriptsDir = path.join(repoDir, "scripts");
    const srcDir = path.join(repoDir, "src");
    const binDir = path.join(repoDir, "bin");
    const scriptPath = path.join(scriptsDir, "resolve-version.sh");
    const fakeGitPath = path.join(binDir, "git");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    copyFileSync(sourceScriptPath, scriptPath);
    chmodSync(scriptPath, 0o755);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-version-fixture", version: "1.2.3" }, null, 2),
      "utf8",
    );

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
set -eu
case "$*" in
  "rev-parse --show-toplevel") printf '%s\n' "$PWD" ;;
  "ls-files --error-unmatch src/version.ts") exit 1 ;;
  "fetch --tags --quiet") exit 0 ;;
  "describe --tags --abbrev=0") printf '1.2.3\n' ;;
  "rev-parse HEAD") printf 'abc123def4567890abc123def4567890abc123de\n' ;;
  "diff --quiet HEAD --") exit 0 ;;
  "describe --tags --exact-match HEAD") exit 1 ;;
  *)
    printf 'unexpected git invocation: %s\n' "$*" >&2
    exit 2
    ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGitPath, 0o755);

    const result = spawnSync("bash", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3-abc12");
    expect(readFileSync(path.join(srcDir, "version.ts"), "utf8")).toBe("export const APP_VERSION = '1.2.3-abc12';\n");
  });
});

describe("resolve-build-version.mjs", () => {
  it("falls back to package.json when run outside a git checkout", () => {
    const repoDir = createTempDir("resolve-build-version-no-git-");
    const scriptsDir = path.join(repoDir, "scripts");
    const scriptPath = path.join(scriptsDir, "resolve-build-version.mjs");

    mkdirSync(scriptsDir, { recursive: true });
    copyFileSync(sourceBuildVersionScriptPath, scriptPath);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-build-version-fixture", version: "1.2.3" }, null, 2),
      "utf8",
    );

    const result = spawnSync("node", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: withoutInjectedVersions(),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3");
  });

  it("derives the latest git tag and exact five-character commit id for dirty tracked changes", () => {
    const repoDir = createTempDir("resolve-build-version-");
    const scriptsDir = path.join(repoDir, "scripts");
    const binDir = path.join(repoDir, "bin");
    const scriptPath = path.join(scriptsDir, "resolve-build-version.mjs");
    const fakeGitPath = path.join(binDir, "git");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    copyFileSync(sourceBuildVersionScriptPath, scriptPath);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-build-version-fixture", version: "0.0.0" }, null, 2),
      "utf8",
    );

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
set -eu
case "$*" in
  "rev-parse --show-toplevel") printf '%s\n' "$PWD" ;;
  "fetch --tags --quiet") exit 0 ;;
  "describe --tags --abbrev=0") printf '1.2.3\n' ;;
  "describe --tags --exact-match HEAD") exit 1 ;;
  "rev-parse --is-shallow-repository") printf 'false\n' ;;
  "rev-parse HEAD") printf 'abc123def4567890abc123def4567890abc123de\n' ;;
  "diff --quiet HEAD --") exit 1 ;;
  *)
    printf 'unexpected git invocation: %s\n' "$*" >&2
    exit 2
    ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGitPath, 0o755);

    const result = spawnSync("node", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...withoutInjectedVersions(),
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3-abc12");
  });

  it("includes the commit id for a clean checkout ahead of the latest git tag", () => {
    const repoDir = createTempDir("resolve-build-version-ahead-");
    const scriptsDir = path.join(repoDir, "scripts");
    const binDir = path.join(repoDir, "bin");
    const scriptPath = path.join(scriptsDir, "resolve-build-version.mjs");
    const fakeGitPath = path.join(binDir, "git");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    copyFileSync(sourceBuildVersionScriptPath, scriptPath);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-build-version-fixture", version: "0.0.0" }, null, 2),
      "utf8",
    );

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
set -eu
case "$*" in
  "rev-parse --show-toplevel") printf '%s\n' "$PWD" ;;
  "fetch --tags --quiet") exit 0 ;;
  "describe --tags --abbrev=0") printf '1.2.3\n' ;;
  "describe --tags --exact-match HEAD") exit 1 ;;
  "rev-parse --is-shallow-repository") printf 'false\n' ;;
  "rev-parse HEAD") printf 'abc123def4567890abc123def4567890abc123de\n' ;;
  "diff --quiet HEAD --") exit 0 ;;
  *)
    printf 'unexpected git invocation: %s\n' "$*" >&2
    exit 2
    ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGitPath, 0o755);

    const result = spawnSync("node", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...withoutInjectedVersions(),
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3-abc12");
  });

  it("uses the plain tag for an exact clean tag checkout", () => {
    const repoDir = createTempDir("resolve-build-version-exact-tag-");
    const scriptsDir = path.join(repoDir, "scripts");
    const binDir = path.join(repoDir, "bin");
    const scriptPath = path.join(scriptsDir, "resolve-build-version.mjs");
    const fakeGitPath = path.join(binDir, "git");

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    copyFileSync(sourceBuildVersionScriptPath, scriptPath);

    writeFileSync(
      path.join(repoDir, "package.json"),
      JSON.stringify({ name: "resolve-build-version-fixture", version: "0.0.0" }, null, 2),
      "utf8",
    );

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
set -eu
case "$*" in
  "rev-parse --show-toplevel") printf '%s\n' "$PWD" ;;
  "fetch --tags --quiet") exit 0 ;;
  "describe --tags --abbrev=0") printf '1.2.3\n' ;;
  "describe --tags --exact-match HEAD") printf '1.2.3\n' ;;
  "rev-parse --is-shallow-repository") printf 'false\n' ;;
  "rev-parse HEAD") printf 'abc123def4567890abc123def4567890abc123de\n' ;;
  "diff --quiet HEAD --") exit 0 ;;
  *)
    printf 'unexpected git invocation: %s\n' "$*" >&2
    exit 2
    ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGitPath, 0o755);

    const result = spawnSync("node", [scriptPath], {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...withoutInjectedVersions(),
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1.2.3");
  });
});
