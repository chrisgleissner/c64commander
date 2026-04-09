/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { formatBuildInfo, formatBuildTimeUtc, getBuildInfoRows } from "@/lib/buildInfo";

describe("buildInfo", () => {
  it("formats build time in UTC", () => {
    const result = formatBuildTimeUtc("2026-02-05T12:34:56.789Z");
    expect(result).toBe("2026-02-05 12:34:56 UTC");
  });

  it("returns placeholders for missing or invalid input", () => {
    expect(formatBuildTimeUtc("")).toBe("2026-01-01 12:00:00 UTC");
    expect(formatBuildTimeUtc("not-a-date")).toBe("2026-01-01 12:00:00 UTC");
  });

  it("builds version and sha labels", () => {
    const info = formatBuildInfo({
      appVersion: "1.2.3-abcdef12",
      appVersionLabel: "1.2.3-release-label",
      gitSha: "abcdef1234567890",
      buildTime: "2026-02-05T01:02:03Z",
    });

    expect(info.versionLabel).toBe("1.2.3-release-label");
    expect(info.gitShaShort).toBe("abcdef12");
    expect(info.buildTimeUtc).toBe("2026-02-05 01:02:03 UTC");
  });

  it("uses empty defaults for all optional formatBuildInfo parameters when called with an empty object", () => {
    const info = formatBuildInfo({});
    expect(info.appVersion).toBe("");
    expect(info.gitSha).toBe("");
    expect(info.gitShaShort).toBe("");
    expect(info.versionLabel).toBe("\u2014");
    expect(info.buildTimeUtc).toBe("2026-01-01 12:00:00 UTC");
  });

  it("getBuildInfoRows shows em-dash for Git ID when gitShaShort is empty", () => {
    const rows = getBuildInfoRows(formatBuildInfo({ appVersion: "1.0.0" }));
    expect(rows.find((r) => r.testId === "build-info-git")?.value).toBe("\u2014");
  });

  it("getBuildInfoRows uses default getBuildInfo when called without arguments", () => {
    const rows = getBuildInfoRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.testId).toBe("build-info-version");
  });
});
