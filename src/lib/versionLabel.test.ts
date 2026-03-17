/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { deriveVersionLabel, shortenGitId } from "./versionLabel";

describe("versionLabel", () => {
  describe("shortenGitId", () => {
    it("returns the first three git id characters by default", () => {
      expect(shortenGitId("b1141986")).toBe("b11");
    });
  });

  describe("deriveVersionLabel", () => {
    it("returns the exact tag when the build matches the tagged commit exactly", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "0.6.4-rc2-0-gb1141986",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.1.0",
        }),
      ).toBe("0.6.4-rc2");
    });

    it("appends the first three git id characters when commits exist after the latest tag", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "0.6.4-rc2-13-gb1141986",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.1.0",
        }),
      ).toBe("0.6.4-rc2-b11");
    });

    it("appends the first three git id characters when the tag commit has additional uncommitted changes", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "0.6.4-rc2-0-gb1141986-dirty",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.1.0",
        }),
      ).toBe("0.6.4-rc2-b11");
    });

    it("falls back to the package version when git describe does not resolve a tag", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "b1141986",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.6.4-rc2",
        }),
      ).toBe("0.6.4-rc2");
    });
  });
});
