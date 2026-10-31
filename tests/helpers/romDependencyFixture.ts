/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Hex } from "@/lib/romDependency/digest";
import type { RomDependencyAssets } from "@/lib/romDependency/embeddedRomDependencyList";

const FIXTURES = resolve(__dirname, "../fixtures/romDependency");

/**
 * Synthetic list encoded by the sidflow reference encoder (`encodeRomDependencyList`), with
 * `listing_ceiling` 191 and `recommended_min_grade` 128. Grades are [sidliteNone, sidliteKernalBasic, residfpNone, residfpKernalBasic]:
 *   0123..cdef  subtune 1: 0, 254, 120, 253    subtune 3: 255, 255, 150, 255
 *   fedc..3210  subtune 256: 191, 255, 254, 255
 *   SYNTHETIC_SID_MD5 (the file `synthetic.sid`)
 *               subtune 1: 0, 255, 120, 253
 *               subtune 2: 254, 100, 255, 127    (127 is the threshold minus one)
 *               subtune 3: 128, 255, 129, 254    (128 is the threshold itself)
 */
export const SYNTHETIC_SID_MD5 = "788728f8e8eb6f7e2c5918b28383a1d6";

export const readFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

export const syntheticSid = (): Uint8Array => readFixture("synthetic.sid");

export const specExampleBin = (): Uint8Array => readFixture("spec-example-sidromdep-1.bin");

/** Three byte patterns standing in for the reference ROMs; the tests never need the real (copyrighted) images. */
export const FAKE_ROMS = {
  kernal: new Uint8Array(8192).fill(0x4b),
  basic: new Uint8Array(8192).fill(0x42),
  chargen: new Uint8Array(4096).fill(0x43),
};

export const FAKE_REFERENCE_ROMS = {
  kernal: sha256Hex(FAKE_ROMS.kernal),
  basic: sha256Hex(FAKE_ROMS.basic),
  chargen: sha256Hex(FAKE_ROMS.chargen),
};

/** The synthetic list with a manifest that names {@link FAKE_REFERENCE_ROMS}, and the pin that matches it. */
export const syntheticAssets = (
  overrides: { bin?: Uint8Array; manifest?: (m: Record<string, unknown>) => void } = {},
): { assets: RomDependencyAssets; pin: string } => {
  const bin = overrides.bin ?? readFixture("synthetic-sidromdep-1.bin");
  const manifest = JSON.parse(readFileSync(resolve(FIXTURES, "synthetic-sidromdep-1.manifest.json"), "utf8"));
  manifest.binary.sha256 = sha256Hex(bin);
  manifest.binary.bytes = bin.length;
  manifest.measuredProfile.referenceRoms = FAKE_REFERENCE_ROMS;
  overrides.manifest?.(manifest);
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  return { assets: { bin, manifestText }, pin: sha256Hex(new TextEncoder().encode(manifestText)) };
};
