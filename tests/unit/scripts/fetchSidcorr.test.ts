/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SIDCORR_RELEASE, verifyBundleSha256 } from "../../../scripts/fetch-sidcorr.mjs";
import {
  SIDCORR_BUNDLE_ASSET,
  SIDCORR_BUNDLE_PUBLIC_PATH,
  SIDCORR_BUNDLE_SHA256,
  SIDCORR_EXPECTED,
  SIDCORR_MANIFEST_ASSET,
  SIDCORR_RELEASE_TAG,
  SIDCORR_REPO,
} from "@/lib/sidRadio/sidcorrRelease";

describe("fetch-sidcorr pinned release", () => {
  it("pins a lowercase 64-hex sha256", () => {
    expect(SIDCORR_BUNDLE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the build script and the app constants in lockstep (no drift)", () => {
    // The .mjs build script and the TS app module both need the pin. This
    // guard fails loudly if they ever diverge (single source of truth).
    expect(SIDCORR_RELEASE.bundleSha256).toBe(SIDCORR_BUNDLE_SHA256);
    expect(SIDCORR_RELEASE.repo).toBe(SIDCORR_REPO);
    expect(SIDCORR_RELEASE.tag).toBe(SIDCORR_RELEASE_TAG);
    expect(SIDCORR_RELEASE.bundleAsset).toBe(SIDCORR_BUNDLE_ASSET);
    expect(SIDCORR_RELEASE.manifestAsset).toBe(SIDCORR_MANIFEST_ASSET);
    expect(SIDCORR_RELEASE.publicPath).toBe(SIDCORR_BUNDLE_PUBLIC_PATH);
    expect(SIDCORR_RELEASE.expected).toEqual(SIDCORR_EXPECTED);
  });

  it("verifies a matching buffer and rejects a mismatched one", () => {
    const good = Buffer.from("hello sidcorr");
    const sha = createHash("sha256").update(good).digest("hex");
    expect(verifyBundleSha256(good, sha)).toBe(true);
    expect(verifyBundleSha256(good, "0".repeat(64))).toBe(false);
    // A tampered byte flips the digest.
    const bad = Buffer.from("hello sidcorr!");
    expect(verifyBundleSha256(bad, sha)).toBe(false);
  });

  it("targets the git-ignored public asset path", () => {
    expect(SIDCORR_BUNDLE_PUBLIC_PATH).toBe("data/sidcorr/hvsc-tiny.sidcorr");
    // Runtime fetch URL is the public path served from the web root.
    expect(SIDCORR_RELEASE.publicPath.startsWith("data/")).toBe(true);
  });
});
