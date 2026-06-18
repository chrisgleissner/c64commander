import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const latestGitTag = () => {
  const describe = () =>
    spawnSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: process.cwd(), encoding: "utf8" });

  let result = describe();
  if (result.status !== 0) {
    spawnSync("git", ["fetch", "--tags", "--quiet"], { cwd: process.cwd(), encoding: "utf8" });
    result = describe();
  }

  if (result.status === 0) return result.stdout.trim();

  const pkgVersion = readJson("package.json").version;
  if (typeof pkgVersion === "string" && pkgVersion.trim()) return pkgVersion.trim();

  throw new Error(`Unable to resolve latest Git tag: ${result.stderr || result.stdout}`);
};

describe("release version metadata", () => {
  it("keeps package metadata aligned with the latest Git tag used by build identity", () => {
    const expectedVersion = latestGitTag();
    const packageJson = readJson("package.json");
    const packageLock = readJson("package-lock.json");
    const rootLockPackage = (packageLock.packages as Record<string, Record<string, unknown>>)[""];

    expect(packageJson.version).toBe(expectedVersion);
    expect(packageLock.version).toBe(expectedVersion);
    expect(rootLockPackage.version).toBe(expectedVersion);
  });
});
