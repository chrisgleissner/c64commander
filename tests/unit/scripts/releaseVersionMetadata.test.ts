import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveBuildVersion } from "../../../scripts/resolve-build-version.mjs";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

/** Same safe token the release tooling accepts for a version/tag (see resolve-build-version.mjs). */
const VERSION_TOKEN = /^[0-9A-Za-z._-]+$/;

describe("release version metadata", () => {
  it("keeps package.json and the lockfile internally consistent", () => {
    const packageJson = readJson("package.json");
    const packageLock = readJson("package-lock.json");
    const rootLockPackage = (packageLock.packages as Record<string, Record<string, unknown>>)[""];

    const version = packageJson.version;
    expect(typeof version).toBe("string");
    expect(version as string).toMatch(VERSION_TOKEN);

    // package.json is the in-tree dev baseline; the lockfile must agree with it so
    // a botched/partial version bump can never ship a desynced lockfile. This is
    // intentionally decoupled from the Git tag: release tags are applied from the
    // GitHub Releases UI (which does not bump package.json) and DRIVE the build
    // identity via resolve-build-version.mjs — so requiring package.json to equal
    // the latest tag would (and did) break every UI-created tag build.
    expect(packageLock.version).toBe(version);
    expect(rootLockPackage.version).toBe(version);
  });

  it("derives the build version from the applied tag, so any GitHub-UI tag is honoured", () => {
    // A tag created on the GitHub Releases UI sets GITHUB_REF_TYPE=tag and
    // GITHUB_REF_NAME=<tag>; the resolver returns it verbatim, independent of the
    // package.json version. This is what makes "tag anything from the UI" safe.
    for (const tag of ["0.8.9-rc1", "1.2.3", "2.0.0-beta.4", "v3.0.0"]) {
      const resolved = resolveBuildVersion({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: tag });
      expect(resolved).toBe(tag);
    }
  });
});
