/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { deriveVersionLabel, shortenGitId } from "@/lib/versionLabel";

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
          gitDescribe: "0.6.4-rc4-0-gb1141986",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.1.0",
        }),
      ).toBe("0.6.4-rc4");
    });

    it("appends the first three git id characters when commits exist after the latest tag", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "0.6.4-rc4-13-gb1141986",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.1.0",
        }),
      ).toBe("0.6.4-rc4-b11");
    });

    it("appends the first three git id characters when the tag commit has additional uncommitted changes", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "0.6.4-rc4-0-gb1141986-dirty",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.1.0",
        }),
      ).toBe("0.6.4-rc4-b11");
    });

    it("falls back to the package version when git describe does not resolve a tag", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "b1141986",
          gitSha: "b1141986f00d",
          fallbackVersion: "0.6.4-rc4",
        }),
      ).toBe("0.6.4-rc4");
    });

    it("uses the sha from git describe when gitSha is absent but commits exist after the tag", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "0.6.4-rc4-3-gabc1234",
          gitSha: "",
        }),
      ).toBe("0.6.4-rc4-abc");
    });

    it("falls back to the sha from the bare-sha describe when gitSha and fallbackVersion are absent", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "abc1234",
          gitSha: "",
          fallbackVersion: "",
        }),
      ).toBe("abc");
    });

    it("uses the gitSha over the sha captured in a bare describe", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "abc1234",
          gitSha: "def5678",
          fallbackVersion: "",
        }),
      ).toBe("def");
    });

    it("returns the describe string verbatim when it does not match any known pattern", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "custom-build/label",
          gitSha: "",
          fallbackVersion: "",
        }),
      ).toBe("custom-build/label");
    });

    it("returns the fallback version when describe is empty", () => {
      expect(
        deriveVersionLabel({
          gitDescribe: "",
          gitSha: "",
          fallbackVersion: "1.2.3",
        }),
      ).toBe("1.2.3");
    });

    it("returns the em-dash placeholder when describe and fallback are both absent", () => {
      expect(deriveVersionLabel({})).toBe("—");
    });
  });
});
