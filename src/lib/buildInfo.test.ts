/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { formatBuildInfo, formatBuildTimeUtc } from "./buildInfo";

describe("buildInfo", () => {
  describe("formatBuildTimeUtc", () => {
    it("returns the placeholder when the build time is invalid", () => {
      expect(formatBuildTimeUtc("not-a-date")).toBe("2026-01-01 12:00:00 UTC");
    });
  });

  describe("formatBuildInfo", () => {
    it("prefers the git-derived app version label over the package version", () => {
      expect(
        formatBuildInfo({
          appVersion: "0.6.4-rc2",
          appVersionLabel: "0.6.4-rc2-b11",
          gitSha: "b1141986f00d",
          buildTime: "2026-03-17T12:34:56.000Z",
        }),
      ).toMatchObject({
        appVersion: "0.6.4-rc2",
        gitSha: "b1141986f00d",
        gitShaShort: "b1141986",
        versionLabel: "0.6.4-rc2-b11",
        buildTimeUtc: "2026-03-17 12:34:56 UTC",
      });
    });

    it("falls back to the package version when no derived label is provided", () => {
      expect(
        formatBuildInfo({
          appVersion: "0.6.4-rc2",
          gitSha: "b1141986f00d",
          buildTime: "2026-03-17T12:34:56.000Z",
        }).versionLabel,
      ).toBe("0.6.4-rc2");
    });
  });
});
