#!/usr/bin/env node
/*
 * Fetches the pinned libsidplayfp WASM engine into
 *   public/wasm/libsidplayfp/
 * and verifies every file against the release's own SHA256SUMS.
 *
 * WHY THIS EXISTS
 * ---------------
 * The engine used to be a hand-copied binary committed to this repo. That is
 * how it went wrong: for months the artifact was SIDLite rather than the
 * accurate reSIDfp, and nothing could tell, because a committed blob carries no
 * version, no provenance and no check. It also meant every engine change added
 * ~425 KB to this repo's history forever.
 *
 * sidflow now attaches `libsidplayfp-wasm-<tag>.tar.gz` plus `SHA256SUMS` to
 * every release (reSIDfp in the root, SIDLite under `sidlite/`). This fetches
 * that, exactly like `fetch-sidcorr.mjs` fetches the similarity bundle.
 *
 * BUILD TIME, NOT RUNTIME. This runs in `prebuild`, i.e. before `vite build`
 * and therefore before Capacitor copies `dist/` into the native bundle, so the
 * engine ships *inside* the APK / IPA / Docker image. The app never downloads
 * it: `localSid.worker.ts` imports `/wasm/libsidplayfp/index.js` from the
 * packaged web root.
 *
 * Behaviour mirrors fetch-sidcorr.mjs:
 *   - already present and matching the pin  → do nothing (offline-friendly)
 *   - otherwise download, then verify every file's sha256
 *   - a sha256 MISMATCH is a hard failure — the pin must not drift
 *   - a network failure with no cached copy is a soft warning, because the app
 *     degrades to "on-device playback unavailable" and plays on the C64
 *     instead; `--required` upgrades that to a hard failure for release builds
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

/**
 * The pin.
 *
 * `tag` is deliberately null until sidflow cuts the first release carrying the
 * asset (the workflow landed in sidflow 8b2617d; release 0.6.0 predates it).
 * While it is null this script is a no-op and the checked-in engine under
 * public/wasm/libsidplayfp/ is used as-is — see VENDORING.md. To switch over:
 * set `tag`, run this script once, copy the printed SHA256SUMS digest into
 * `checksumsSha256`, then delete the committed binaries and un-ignore nothing
 * (the .gitignore entry is already prepared).
 */
export const LIBSIDPLAYFP_WASM_RELEASE = {
  repo: "chrisgleissner/sidflow",
  tag: null,
  /** sha256 of the release's SHA256SUMS file; every payload file is checked against that. */
  checksumsSha256: null,
  /** Where the engine lands, relative to public/. */
  publicDir: "wasm/libsidplayfp",
  /**
   * Files taken from the tarball root, which is the reSIDfp build. SIDLite
   * lives under `sidlite/` in the same tarball and is deliberately NOT shipped:
   * it is a fast approximation that measurably does not sound like a C64
   * (docs/plans/sid-station/AUDIO-FIDELITY-TEST.md).
   */
  files: ["libsidplayfp.js", "libsidplayfp.wasm", "LICENSE"],
};

export const sha256Hex = (buffer) => createHash("sha256").update(buffer).digest("hex");

export const tarballName = (release = LIBSIDPLAYFP_WASM_RELEASE) => `libsidplayfp-wasm-${release.tag}.tar.gz`;

export const tarballUrl = (release = LIBSIDPLAYFP_WASM_RELEASE) =>
  `https://github.com/${release.repo}/releases/download/${release.tag}/${tarballName(release)}`;

/** Parse a `sha256sum` file into { relativePath: digest }. */
export const parseChecksums = (text) => {
  const entries = {};
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match) entries[match[2]] = match[1].toLowerCase();
  }
  return entries;
};

/** True iff every wanted file is present in the extracted tree and matches SHA256SUMS. */
export const verifyExtracted = async (dir, checksums, files, readFile = fs.readFile) => {
  for (const file of files) {
    const expected = checksums[file];
    if (!expected) return { ok: false, reason: `${file} is missing from SHA256SUMS` };
    let actual;
    try {
      actual = sha256Hex(await readFile(path.join(dir, file)));
    } catch {
      return { ok: false, reason: `${file} is missing from the tarball` };
    }
    if (actual !== expected) return { ok: false, reason: `${file} sha256 ${actual} != pinned ${expected}` };
  }
  return { ok: true };
};

const warn = (message) => console.warn(`[fetch-libsidplayfp-wasm] ${message}`);
const info = (message) => console.log(`[fetch-libsidplayfp-wasm] ${message}`);

async function main() {
  const required = process.argv.includes("--required");
  const release = LIBSIDPLAYFP_WASM_RELEASE;
  const target = path.join(REPO_ROOT, "public", release.publicDir);

  if (!release.tag) {
    info(
      "no release pinned yet — using the engine committed under public/wasm/libsidplayfp/. " +
        "Set LIBSIDPLAYFP_WASM_RELEASE.tag once sidflow publishes a release carrying " +
        "libsidplayfp-wasm-<tag>.tar.gz (see the comment on the pin).",
    );
    return 0;
  }

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "libsidplayfp-wasm-"));
  try {
    const url = tarballUrl(release);
    info(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const tarball = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(path.join(scratch, "asset.tar.gz"), tarball);

    const sumsUrl = `https://github.com/${release.repo}/releases/download/${release.tag}/SHA256SUMS`;
    const sumsResponse = await fetch(sumsUrl);
    if (!sumsResponse.ok) throw new Error(`HTTP ${sumsResponse.status} for ${sumsUrl}`);
    const sumsText = await sumsResponse.text();

    if (release.checksumsSha256 && sha256Hex(Buffer.from(sumsText)) !== release.checksumsSha256) {
      // Hard failure: the pin is the whole point. Never "refresh" it to make a
      // build pass — that is how an unnoticed engine swap happened before.
      throw Object.assign(
        new Error(
          `SHA256SUMS digest ${sha256Hex(Buffer.from(sumsText))} does not match the pin ` +
            `${release.checksumsSha256}. The release was re-cut or tampered with; do not update the ` +
            `pin without re-running the engine parity checks in sidflow.`,
        ),
        { hard: true },
      );
    }
    info(`SHA256SUMS digest ${sha256Hex(Buffer.from(sumsText))}`);

    execFileSync("tar", ["-xzf", path.join(scratch, "asset.tar.gz"), "-C", scratch, "--strip-components=1"], {
      stdio: "inherit",
    });

    const verification = await verifyExtracted(scratch, parseChecksums(sumsText), release.files);
    if (!verification.ok) throw Object.assign(new Error(verification.reason), { hard: true });

    await fs.mkdir(target, { recursive: true });
    for (const file of release.files) {
      await fs.copyFile(path.join(scratch, file), path.join(target, file));
    }
    info(`installed ${release.files.length} files → public/${release.publicDir} (${release.tag})`);
    return 0;
  } catch (error) {
    if (error?.hard || required) {
      console.error(`[fetch-libsidplayfp-wasm] ${error.message}`);
      return 1;
    }
    warn(
      `${error.message}\n[fetch-libsidplayfp-wasm] continuing without a refreshed engine — ` +
        `on-device playback falls back to the C64 if it is missing entirely.`,
    );
    return 0;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
