import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findOutdatedDependencies } from "../../../scripts/mcp-runtime-dependencies.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const writeJson = (file: string, value: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf8");
};

const installPackage = (packageDir: string, name: string, version: string) =>
  writeJson(path.join(packageDir, "node_modules", name, "package.json"), { name, version });

/** A package whose lockfile pins zod 4.6.7, the shape of droidctl after the zod 4 bump. */
const createLockedPackage = (installedZod: string | null) => {
  const packageDir = mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-deps-"));
  tempDirs.push(packageDir);
  writeJson(path.join(packageDir, "package.json"), { name: "droidctl", private: true });
  writeJson(path.join(packageDir, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { zod: "^4.6.7", "@modelcontextprotocol/sdk": "^1.32.0" }, devDependencies: { tsx: "^4" } },
      "node_modules/zod": { version: "4.6.7" },
      "node_modules/@modelcontextprotocol/sdk": { version: "1.32.0" },
      "node_modules/tsx": { version: "4.20.0" },
    },
  });
  installPackage(packageDir, "@modelcontextprotocol/sdk", "1.32.0");
  installPackage(packageDir, "tsx", "4.20.0");
  if (installedZod) installPackage(packageDir, "zod", installedZod);
  writeFileSync(path.join(packageDir, "src.ts"), "", "utf8");
  return packageDir;
};

describe("findOutdatedDependencies", () => {
  it("reports a direct dependency installed at a version other than the one the lockfile pins", () => {
    const packageDir = createLockedPackage("3.25.76");
    expect(findOutdatedDependencies(packageDir)).toEqual([{ name: "zod", locked: "4.6.7", installed: "3.25.76" }]);
  });

  it("reports a locked direct dependency that is not installed at all", () => {
    const packageDir = createLockedPackage(null);
    expect(findOutdatedDependencies(packageDir)).toEqual([{ name: "zod", locked: "4.6.7", installed: null }]);
  });

  it("reports nothing when every direct dependency matches the lockfile", () => {
    expect(findOutdatedDependencies(createLockedPackage("4.6.7"))).toEqual([]);
  });

  it("reports nothing for a package without a lockfile", () => {
    const packageDir = mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-deps-"));
    tempDirs.push(packageDir);
    writeJson(path.join(packageDir, "package.json"), { name: "x" });
    expect(findOutdatedDependencies(packageDir)).toEqual([]);
  });
});

describe("droidctl MCP start script", () => {
  const runStart = (packageDir: string, npmCiInstallsZod: string) => {
    const binDir = path.join(packageDir, "bin");
    const logPath = path.join(packageDir, "npm-invocations.log");
    mkdirSync(binDir, { recursive: true });
    const zodManifest = path.join(packageDir, "node_modules", "zod", "package.json");
    writeFileSync(
      path.join(binDir, "npm"),
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "ci" ]; then
  echo "added 1 package in 1s"
  mkdir -p "$(dirname "${zodManifest}")"
  printf '{"name":"zod","version":"${npmCiInstallsZod}"}\\n' > "${zodManifest}"
  exit 0
fi
if [ "$1" = "exec" ]; then
  exit 0
fi
exit 1
`,
      "utf8",
    );
    chmodSync(path.join(binDir, "npm"), 0o755);
    const result = spawnSync(process.execPath, [path.resolve(process.cwd(), "droidctl/scripts/start.mjs")], {
      encoding: "utf8",
      env: { ...process.env, DROIDCTL_DIR: packageDir, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    });
    return { result, npmCalls: readFileSync(logPath, "utf8").trim().split("\n") };
  };

  it("reinstalls with npm ci when an installed dependency is older than the lockfile, before starting", () => {
    const { result, npmCalls } = runStart(createLockedPackage("3.25.76"), "4.6.7");
    expect(result.status).toBe(0);
    expect(npmCalls).toEqual(["ci", "exec tsx src/index.ts"]);
    expect(result.stderr).toContain("zod 3.25.76 (locked 4.6.7)");
  });

  it("keeps the install's output off stdout, which carries the MCP protocol", () => {
    const { result } = runStart(createLockedPackage("3.25.76"), "4.6.7");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("added 1 package");
  });

  it("refuses to start when the reinstall still leaves a dependency outdated", () => {
    const { result, npmCalls } = runStart(createLockedPackage("3.25.76"), "3.25.76");
    expect(result.status).toBe(1);
    expect(npmCalls).toEqual(["ci"]);
    expect(result.stderr).toContain("still missing or outdated after npm ci: zod");
  });

  it("starts without installing when every dependency matches the lockfile", () => {
    const packageDir = createLockedPackage("4.6.7");
    const binDir = path.join(packageDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const logPath = path.join(packageDir, "npm.log");
    writeFileSync(path.join(binDir, "npm"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nexit 0\n`, "utf8");
    chmodSync(path.join(binDir, "npm"), 0o755);
    const result = spawnSync(process.execPath, [path.resolve(process.cwd(), "droidctl/scripts/start.mjs")], {
      encoding: "utf8",
      env: { ...process.env, DROIDCTL_DIR: packageDir, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    });
    expect(result.status).toBe(0);
    expect(readFileSync(logPath, "utf8").trim()).toBe("exec tsx src/index.ts");
  });
});
