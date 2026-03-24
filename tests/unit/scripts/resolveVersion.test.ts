import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tempDirs: string[] = [];
const sourceScriptPath = path.resolve(process.cwd(), "scripts/resolve-version.sh");

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
});
