/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SIDCORR_RELEASE,
  fetchSidcorr,
  isFatalStatus,
  sha256Hex,
  verifyBundleSha256,
} from "../../../scripts/fetch-sidcorr.mjs";

const repoRoot = process.cwd();

describe("android packaging (§8.4)", () => {
  it("never adds .sidcorr to a noCompress list (AGP DEFLATE-compresses it by default)", () => {
    const gradle = readFileSync(path.resolve(repoRoot, "android/app/build.gradle"), "utf8");
    const noCompressLines = gradle.match(/noCompress[^\n]*/gi) ?? [];
    for (const line of noCompressLines) {
      expect(line.toLowerCase()).not.toContain("sidcorr");
    }
  });
});

describe("fetch-sidcorr sha256 pin (§8.4)", () => {
  const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  const makeResponse = (bytes: Buffer) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  it("refuses to write a drifted download and reports a fatal status", async () => {
    let wrote = false;
    const result = await fetchSidcorr({
      readFileImpl: async () => {
        throw enoent; // asset absent → exercise the download+verify path
      },
      fetchImpl: async () => makeResponse(Buffer.from("not the real sidcorr bundle")),
      writeFileImpl: async () => {
        wrote = true;
      },
      mkdirImpl: async () => {},
    });
    expect(result.status).toBe("sha-mismatch");
    expect(wrote).toBe(false);
    expect(isFatalStatus(result.status)).toBe(true);
  });

  it("re-downloads a cached asset left behind by an older pin", async () => {
    // The asset is git-ignored, so the only way to hold bytes that do not match
    // is to have fetched an earlier pin — a stale cache, not an attack. Failing
    // the build over it would mean every re-pin breaks every existing checkout
    // with "delete it and re-run", which is what happened moving to
    // sidcorr-hvsc-full-20260726T203707Z, the first time the pin ever moved.
    const pinned = Buffer.from("pinned bundle bytes");
    let wrote: Buffer | null = null;
    const result = await fetchSidcorr({
      readFileImpl: async () => Buffer.from("bytes from an older pin"),
      fetchImpl: async () => makeResponse(pinned),
      writeFileImpl: async (_path: string, data: Buffer) => {
        wrote = data;
      },
      mkdirImpl: async () => {},
      // The real pin belongs to the real bundle; this stands in for it.
      expectedSha: sha256Hex(pinned),
    });
    expect(result.status).toBe("downloaded");
    expect(wrote).toEqual(pinned);
  });

  it("still refuses a bad download when the cache was stale", async () => {
    // The re-download above must not become a way in for wrong bytes: the
    // integrity check moves to the downloaded payload, it does not disappear.
    let wrote = false;
    const result = await fetchSidcorr({
      readFileImpl: async () => Buffer.from("bytes from an older pin"),
      fetchImpl: async () => makeResponse(Buffer.from("not the real sidcorr bundle")),
      writeFileImpl: async () => {
        wrote = true;
      },
      mkdirImpl: async () => {},
    });
    expect(result.status).toBe("sha-mismatch");
    expect(wrote).toBe(false);
    expect(isFatalStatus(result.status)).toBe(true);
  });

  it("writes a correctly-hashed download matching the pin", async () => {
    const realPath = path.resolve(repoRoot, "public", SIDCORR_RELEASE.publicPath);
    if (!existsSync(realPath)) return; // asset is git-ignored; only runs post-fetch
    const real = readFileSync(realPath);
    expect(verifyBundleSha256(real)).toBe(true);
    let written: Buffer | null = null;
    const result = await fetchSidcorr({
      readFileImpl: async () => {
        throw enoent;
      },
      fetchImpl: async () => makeResponse(real),
      writeFileImpl: async (_p: string, data: Buffer) => {
        written = data;
      },
      mkdirImpl: async () => {},
    });
    expect(result.status).toBe("downloaded");
    expect(written).not.toBeNull();
    expect(sha256Hex(written!)).toBe(SIDCORR_RELEASE.bundleSha256);
  });
});
