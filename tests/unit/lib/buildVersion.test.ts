/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { hasInjectedBuildVersion, normalizeReleaseVersion, resolveBuildAppVersion } from "@/lib/buildVersion";

describe("buildVersion", () => {
  describe("normalizeReleaseVersion", () => {
    it("preserves the exact version string", () => {
      expect(normalizeReleaseVersion("v0.6.4-rc5")).toBe("v0.6.4-rc5");
    });
  });

  describe("resolveBuildAppVersion", () => {
    it("prefers an explicit VITE_APP_VERSION over package.json", () => {
      expect(
        resolveBuildAppVersion({
          env: { VITE_APP_VERSION: "v0.6.4-rc5" },
          packageVersion: "0.6.4-rc4",
        }),
      ).toBe("v0.6.4-rc5");
    });

    it("uses the GitHub tag version during tag-triggered builds", () => {
      expect(
        resolveBuildAppVersion({
          env: {
            GITHUB_REF_TYPE: "tag",
            GITHUB_REF_NAME: "0.6.4-rc5",
          },
          packageVersion: "0.6.4-rc4",
        }),
      ).toBe("0.6.4-rc5");
    });

    it("falls back to refs/tags when ref type is unavailable", () => {
      expect(
        resolveBuildAppVersion({
          env: {
            GITHUB_REF: "refs/tags/v0.6.4-rc5",
          },
          packageVersion: "0.6.4-rc4",
        }),
      ).toBe("v0.6.4-rc5");
    });

    it("falls back to the package version for non-tag builds", () => {
      expect(
        resolveBuildAppVersion({
          env: {
            GITHUB_REF_TYPE: "branch",
            GITHUB_REF_NAME: "main",
          },
          packageVersion: "0.6.4-rc4",
        }),
      ).toBe("0.6.4-rc4");
    });

    it("detects injected build versions from tag context", () => {
      expect(
        hasInjectedBuildVersion({
          GITHUB_REF_TYPE: "tag",
          GITHUB_REF_NAME: "0.6.4-rc5",
        }),
      ).toBe(true);
    });

    it("does not treat branch builds as injected release versions", () => {
      expect(
        hasInjectedBuildVersion({
          GITHUB_REF_TYPE: "branch",
          GITHUB_REF_NAME: "main",
        }),
      ).toBe(false);
    });
  });
});
