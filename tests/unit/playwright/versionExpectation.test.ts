import { describe, expect, it } from "vitest";

import { isResolvedVersion, RESOLVED_VERSION_INVARIANT } from "../../../playwright/versionExpectation";

describe("resolved version invariant", () => {
  // Every shape scripts/resolve-version.sh can bake into a build must be accepted,
  // including the prerelease-tag-plus-short-sha form that made the E2E test flaky
  // when a release tag landed mid CI run.
  const accepted = [
    "0.9.1", // exact clean release tag
    "0.8.8",
    "10.20.30",
    "0.9.1-rc1", // exact clean prerelease tag
    "0.9.0-rc3",
    "0.9.1-beta.1",
    "0.9.1-fc94d", // release tag + 5-char short sha (non-exact / dirty)
    "0.9.1-rc1-fc94d", // prerelease tag + 5-char short sha (the flaky case)
    "0.8.6-rc1-abcde",
  ];

  const rejected = [
    "—", // unresolved placeholder
    "",
    "0.9", // not MAJOR.MINOR.PATCH
    "v0.9.1", // leading v
    "main", // branch name
    "feat/keyboard-input",
    "fc94d92c", // bare sha
    "0.9.1-fc94d92c", // 8-char sha masquerading as a prerelease
    "0.9.1-rc1-fc94d92c", // 8-char sha in the short-sha slot
    "0.9.1-abcdef", // 6-char hex is not a valid short sha (must be exactly 5)
    "0.9.1+build.5", // build metadata
    "0.9.1-", // trailing separator
    "0.9.1-rc1 ", // trailing whitespace
    "0.9.1-rc1-FC94D", // short sha must be lowercase hex
  ];

  it.each(accepted)("accepts %s", (version) => {
    expect(RESOLVED_VERSION_INVARIANT.test(version)).toBe(true);
    expect(isResolvedVersion(version)).toBe(true);
  });

  it.each(rejected)("rejects %s", (version) => {
    expect(RESOLVED_VERSION_INVARIANT.test(version)).toBe(false);
    expect(isResolvedVersion(version)).toBe(false);
  });

  it("is anchored so it never matches a substring of a longer string", () => {
    expect(isResolvedVersion("prefix 0.9.1")).toBe(false);
    expect(isResolvedVersion("0.9.1 suffix")).toBe(false);
  });
});
