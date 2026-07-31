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
  tag: "0.8.2",
  bundleAsset: "sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr",
  manifestAsset: "sidcorr-hvsc-full-sidcorr-tiny-1.manifest.json",
  bundleSha256: "10db2838831bb2386f6dd19041a7ae8525878c401afa6eaf932d9b1610c1c0bc",
  publicPath: "data/sidcorr/hvsc-tiny.sidcorr",
  expected: {
    fileCount: 61157,
    trackCount: 87868,
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

const readIfExists = async (absPath, readFile) => {
  try {
    return await readFile(absPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const logError = (message) => {
  console.error(`[fetch-sidcorr] ${message}`);
};

// fs is injectable so the sha-drift / write paths are unit-testable without
// touching the real asset. The function is side-effect-free w.r.t. process
// exit; the CLI runner maps the returned status to an exit code (see below).
/**
 * Check the populations of a bundle that is now on disk, and report offenders.
 *
 * Kept next to the fetch so the build has exactly one place that decides whether
 * the shipped corpus is fit to release.
 */
const gateStylePopulations = (buffer, readPopulationsImpl = readStylePopulations) => {
  let populations;
  try {
    populations = readPopulationsImpl(buffer);
  } catch (error) {
    console.error(`[fetch-sidcorr] could not read style populations: ${error.message}`);
    return { ok: false };
  }
  const offenders = assertStylePopulations(populations);
  if (offenders.length === 0) {
    const smallest = Object.entries(populations).sort(([, a], [, b]) => a - b)[0];
    console.log(
      `[fetch-sidcorr] style populations ok (${Object.keys(populations).length} styles, ` +
        `smallest ${smallest[0]} at ${smallest[1].toLocaleString()}, floor ${MIN_STYLE_POPULATION.toLocaleString()})`,
    );
    return { ok: true };
  }
  for (const { key, count } of offenders) {
    console.error(
      `[fetch-sidcorr] style "${key}" has ${count.toLocaleString()} tracks, ` +
        `below the ${MIN_STYLE_POPULATION.toLocaleString()} a release must offer.`,
    );
  }
  return { ok: false };
};

export const fetchSidcorr = async ({
  required = false,
  fetchImpl = fetch,
  readFileImpl = (absPath) => fs.readFile(absPath),
  writeFileImpl = (absPath, data) => fs.writeFile(absPath, data),
  mkdirImpl = (dir, options) => fs.mkdir(dir, options),
  // Injectable alongside the rest so a test can exercise the accept path with
  // stand-in bytes; the real bundle is git-ignored and may not be on disk.
  expectedSha = SIDCORR_RELEASE.bundleSha256,
  // Injectable so a test can exercise the sha and caching paths with a stub asset
  // that is deliberately not a real bundle. A build never overrides it.
  readPopulationsImpl = readStylePopulations,
} = {}) => {
  const targetPath = path.join(REPO_ROOT, "public", SIDCORR_RELEASE.publicPath);

  const existing = await readIfExists(targetPath, readFileImpl);
  if (existing) {
    if (verifyBundleSha256(existing, expectedSha)) {
      console.log(`[fetch-sidcorr] up to date (${existing.length} bytes, sha ok): ${SIDCORR_RELEASE.publicPath}`);
      if (!gateStylePopulations(existing, readPopulationsImpl).ok) {
        return { status: "style-population-too-small", path: targetPath };
      }
      return { status: "cached", path: targetPath };
    }
    // A local file that does not match the pin is a STALE CACHE, not an attack:
    // the asset is git-ignored, so the only way to hold a different one is to
    // have fetched an earlier pin. Re-downloading loses nothing and keeps a
    // re-pin from breaking every existing checkout — which it did, because the
    // pin had never moved until sidcorr-hvsc-full-20260726T203707Z. Integrity is
    // unchanged: the downloaded bytes are still verified against the pin below,
    // and a mismatch there is still fatal.
    console.warn(
      `[fetch-sidcorr] cached bundle at ${SIDCORR_RELEASE.publicPath} predates the current pin ` +
        `(${SIDCORR_RELEASE.bundleSha256}) — re-downloading.`,
    );
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
      logError(`${message} (--required)`);
      return { status: "download-failed", path: targetPath };
    }
    console.warn(
      `[fetch-sidcorr] ${message}\n` +
        `[fetch-sidcorr] SID Radio flags default off during rollout — continuing without the bundle.`,
    );
    return { status: "skipped-offline", path: targetPath };
  }

  if (!verifyBundleSha256(buffer, expectedSha)) {
    logError(
      `downloaded bundle sha256 ${sha256Hex(buffer)} != pinned ${SIDCORR_RELEASE.bundleSha256}. ` +
        `Refusing to write a drifted asset.`,
    );
    return { status: "sha-mismatch", path: targetPath };
  }

  await mkdirImpl(path.dirname(targetPath), { recursive: true });
  await writeFileImpl(targetPath, buffer);
  console.log(`[fetch-sidcorr] downloaded ${buffer.length} bytes → ${SIDCORR_RELEASE.publicPath} (sha ok)`);
  if (!gateStylePopulations(buffer, readPopulationsImpl).ok) {
    return { status: "style-population-too-small", path: targetPath };
  }
  return { status: "downloaded", path: targetPath };
};

/**
 * The smallest a mood may be before a release is not worth shipping.
 *
 * The launcher no longer prints a per-mood track count, because every mood drew
 * on tens of thousands of tunes and the figures sat within a few per cent of each
 * other — the number told a listener nothing about which mood to pick. Dropping
 * it means a release that quietly lost most of a mood would no longer be visible
 * on screen, so the check moves here, where it can stop the build instead of
 * reaching a listener.
 */
export const MIN_STYLE_POPULATION = 10_000;

/**
 * Count how many tracks carry each style, straight from the bundle.
 *
 * Deliberately a re-count rather than a read of the manifest's own figures: the
 * bundle is the only artefact the app ships, so it is the only one worth
 * believing. The offsets mirror `parseSidcorrTiny`; a unit test builds a fixture
 * with known populations and asserts this reader and the app's parser agree, so
 * the two cannot drift apart unnoticed.
 */
export const readStylePopulations = (buffer) => {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder();
  const magic = decoder.decode(buffer.subarray(0, 8));
  if (magic !== "SIDTINY1") {
    throw new Error(`not a sidcorr-tiny-1 bundle (magic ${JSON.stringify(magic)})`);
  }

  const trackCount = view.getUint32(12, true);
  const styleCount = view.getUint16(20, true);
  const styleTableOffset = view.getUint32(32, true);
  const styleMaskOffset = view.getUint32(44, true);

  // STYLE_TABLE: a 12-byte section header, then one fixed-width record per style,
  // then a payload the records point into for the key and label text.
  const recordBytes = view.getUint16(styleTableOffset + 4, true);
  const recordStart = styleTableOffset + 12;
  const payloadStart = recordStart + recordBytes * styleCount;

  const populations = {};
  const maskBits = [];
  for (let index = 0; index < styleCount; index += 1) {
    const record = recordStart + index * recordBytes;
    const maskBit = view.getUint8(record + 1);
    const keyOffset = view.getUint32(record + 8, true);
    const keyLength = view.getUint16(record + 12, true);
    const key = decoder.decode(buffer.subarray(payloadStart + keyOffset, payloadStart + keyOffset + keyLength));
    populations[key] = 0;
    maskBits.push({ key, maskBit });
  }

  // STYLE_MASK_TABLE: one u16 per track, a set bit meaning the track carries that style.
  for (let ordinal = 0; ordinal < trackCount; ordinal += 1) {
    const mask = view.getUint16(styleMaskOffset + ordinal * 2, true);
    for (const { key, maskBit } of maskBits) {
      if ((mask & (1 << maskBit)) !== 0) populations[key] += 1;
    }
  }
  return populations;
};

/**
 * Fail the build when any mood has too little to offer.
 *
 * Returns the offending entries rather than throwing, so the caller decides what
 * to do and a test can assert on the result without catching.
 */
export const assertStylePopulations = (populations, minimum = MIN_STYLE_POPULATION) =>
  Object.entries(populations)
    .filter(([, count]) => count < minimum)
    .map(([key, count]) => ({ key, count }));

/** Statuses a build must treat as fatal (pin drift, or a required-but-missing asset). */
export const isFatalStatus = (status) =>
  status === "sha-mismatch" || status === "download-failed" || status === "style-population-too-small";

const isDirectRun = () => {
  const invoked = process.argv[1];
  return invoked ? import.meta.url === pathToFileURL(invoked).href : false;
};

if (isDirectRun()) {
  const required = process.argv.includes("--required");
  fetchSidcorr({ required })
    .then((result) => {
      if (isFatalStatus(result.status)) process.exitCode = 1;
    })
    .catch((error) => {
      console.error("[fetch-sidcorr] unexpected failure", error);
      process.exitCode = 1;
    });
}
