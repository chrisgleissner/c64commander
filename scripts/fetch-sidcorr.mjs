#!/usr/bin/env node
/*
 * Fetches the pinned SID Radio similarity bundle (sidcorr-tiny-1) into
 *   public/data/sidcorr/hvsc-tiny.sidcorr
 * and verifies it against the committed sha256 pin. The asset is git-ignored;
 * this runs before `vite build` (and therefore before Capacitor copies
 * `dist/` into the native bundle) so the ~1.8 MB bundle ships inside the app.
 *
 * Behaviour:
 *   - If the asset already exists and matches the pin, do nothing (idempotent,
 *     offline-friendly — a developer who already fetched it never hits the net).
 *   - Otherwise download it from the GitHub release and verify the sha256.
 *   - A sha256 MISMATCH is a hard failure (exit 1) — the pin must not drift.
 *   - A network failure with no cached asset is a soft warning (exit 0): the
 *     SID Radio flags default off during rollout, so the app still builds and
 *     is byte-for-byte unchanged without the bundle. `--required` upgrades this
 *     to a hard failure for release builds.
 *
 * The `SIDCORR_RELEASE` export below is the build-side copy of the pin; a test
 * (tests/unit/scripts/fetchSidcorr.test.ts) asserts it never drifts from the
 * app-side source of truth in src/lib/sidRadio/sidcorrRelease.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const SIDCORR_RELEASE = {
  repo: "chrisgleissner/sidflow-data",
  tag: "sidcorr-hvsc-full-20260407T115218Z",
  bundleAsset: "sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr",
  manifestAsset: "sidcorr-hvsc-full-sidcorr-tiny-1.manifest.json",
  bundleSha256: "37ceb567faa2acc062e36c31ae7ae074dbdc05e6fc98709a29a483d3705d7d1b",
  publicPath: "data/sidcorr/hvsc-tiny.sidcorr",
  expected: {
    fileCount: 60571,
    trackCount: 87073,
    neighborsPerTrack: 3,
    styleCount: 9,
  },
};

export const sha256Hex = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Returns true iff `buffer`'s sha256 equals `expectedSha` (case-insensitive). */
export const verifyBundleSha256 = (buffer, expectedSha = SIDCORR_RELEASE.bundleSha256) =>
  sha256Hex(buffer) === String(expectedSha).toLowerCase();

export const bundleDownloadUrl = (release = SIDCORR_RELEASE) =>
  `https://github.com/${release.repo}/releases/download/${release.tag}/${release.bundleAsset}`;

const readIfExists = async (absPath) => {
  try {
    return await fs.readFile(absPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const fail = (message) => {
  console.error(`[fetch-sidcorr] ${message}`);
  process.exitCode = 1;
};

export const fetchSidcorr = async ({ required = false, fetchImpl = fetch } = {}) => {
  const targetPath = path.join(REPO_ROOT, "public", SIDCORR_RELEASE.publicPath);

  const existing = await readIfExists(targetPath);
  if (existing) {
    if (verifyBundleSha256(existing)) {
      console.log(`[fetch-sidcorr] up to date (${existing.length} bytes, sha ok): ${SIDCORR_RELEASE.publicPath}`);
      return { status: "cached", path: targetPath };
    }
    fail(
      `existing bundle at ${SIDCORR_RELEASE.publicPath} does not match the pinned sha256 ` +
        `(${SIDCORR_RELEASE.bundleSha256}). Delete it and re-run, or re-pin the release.`,
    );
    return { status: "sha-mismatch", path: targetPath };
  }

  const url = bundleDownloadUrl();
  let buffer;
  try {
    const response = await fetchImpl(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const message = `could not download ${SIDCORR_RELEASE.bundleAsset} from ${url}: ${error?.message ?? error}`;
    if (required) {
      fail(`${message} (--required)`);
      return { status: "download-failed", path: targetPath };
    }
    console.warn(
      `[fetch-sidcorr] ${message}\n` +
        `[fetch-sidcorr] SID Radio flags default off during rollout — continuing without the bundle.`,
    );
    return { status: "skipped-offline", path: targetPath };
  }

  if (!verifyBundleSha256(buffer)) {
    fail(
      `downloaded bundle sha256 ${sha256Hex(buffer)} != pinned ${SIDCORR_RELEASE.bundleSha256}. ` +
        `Refusing to write a drifted asset.`,
    );
    return { status: "sha-mismatch", path: targetPath };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);
  console.log(`[fetch-sidcorr] downloaded ${buffer.length} bytes → ${SIDCORR_RELEASE.publicPath} (sha ok)`);
  return { status: "downloaded", path: targetPath };
};

const isDirectRun = () => {
  const invoked = process.argv[1];
  return invoked ? import.meta.url === pathToFileURL(invoked).href : false;
};

if (isDirectRun()) {
  const required = process.argv.includes("--required");
  fetchSidcorr({ required }).catch((error) => {
    console.error("[fetch-sidcorr] unexpected failure", error);
    process.exitCode = 1;
  });
}
