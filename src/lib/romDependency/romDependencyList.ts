/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Reader for the SID ROM dependency list, format `sidromdep-1`.
 *
 * The list grades, per engine and ROM configuration, how faithfully the HVSC tunes that suffer
 * without the C64's own ROMs still play (255 bit-exact, 254 same music re-timed, 1-253 degraded,
 * 0 no playback). It is allow-by-default: a tune that is not listed is simply playable. The specification
 * is `doc/rom-dependency-list.md` in https://github.com/chrisgleissner/sidflow; section numbers in
 * the comments below refer to it. The reference decoder is
 * `packages/sidflow-common/src/rom-dependency-list.ts` in the same repository. This is a port of
 * the reading half only, so that Commander does not depend on any sidflow package.
 */

import { crc32, sha256Hex } from "./digest";

const MAGIC = "SIDROMDP";
const VERSION = 1;
const HEADER_BYTES = 224;
const FILE_RECORD_BYTES = 17;
const DECISION_RECORD_BYTES = 5;
const FLAG_INCOMPLETE_SOURCE = 0x1;
const MAX_SUBTUNE = 256;
/** §5.2: the largest listing ceiling a list may carry; 254 and 255 both mean "same music" and are never listed. */
const MAX_LISTING_CEILING = 253;

/** §5.5: the order of the four grade bytes of a record. A lane is one (engine, ROM configuration) pair. */
export const ROM_DEP_LANE_NAMES = ["sidliteNone", "sidliteKernalBasic", "residfpNone", "residfpKernalBasic"] as const;
export type RomDepLaneName = (typeof ROM_DEP_LANE_NAMES)[number];

export type RomDepGrades = Record<RomDepLaneName, number>;

export interface RomDepLookup {
  /** True when the (file, subtune) has a record. Unlisted means every lane is above the ceiling, not "verified" (§10.3). */
  listed: boolean;
  /** Exact grades 0..255 when listed. When unlisted every lane reads ceiling+1, a lower bound (§8). */
  grades: RomDepGrades;
}

export interface RomDepHeader {
  hvscRelease: number;
  /** §5.4 bit 0: a developer artefact that a product must not embed. */
  incompleteSource: boolean;
  fileCount: number;
  decisionCount: number;
  /** §5.2: a subtune is listed iff some lane grade is at most this; 1..253. */
  listingCeiling: number;
  /** §10.1: the generator's calibrated default skip threshold, 1..listingCeiling+1. */
  recommendedMinGrade: number;
  payloadSha256: string;
}

export interface RomDependencyList {
  header: RomDepHeader;
  /** Binary search on the full 32-character MD5, then a scan of that file's decisions (§8). */
  lookup(md5: string, subtune: number): RomDepLookup;
}

export class RomDependencyListError extends Error {
  constructor(message: string) {
    super(`Invalid SID ROM dependency list: ${message}`);
    this.name = "RomDependencyListError";
  }
}

/** The grade of one lane in a lookup result. */
export const laneGrade = (lookup: RomDepLookup, lane: RomDepLaneName): number => lookup.grades[lane];

const HEX_MD5 = /^[0-9a-f]{32}$/;

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const md5ToBytes = (md5: string): Uint8Array => {
  if (!HEX_MD5.test(md5)) throw new RomDependencyListError(`MD5 must be 32 lower-case hex characters: ${md5}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(md5.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

const compareMd5 = (bytes: Uint8Array, offset: number, key: Uint8Array): number => {
  for (let i = 0; i < 16; i++) {
    const delta = bytes[offset + i] - key[i];
    if (delta !== 0) return delta;
  }
  return 0;
};

/**
 * Decode and fully validate (§13.1). Any deviation throws: bad magic or version, header or payload
 * checksum, unknown flags, non-canonical layout, truncation, trailing bytes, unordered records,
 * records no lane of which is below the listing ceiling. A caller never receives a partial list.
 */
export function decodeRomDependencyList(bytes: Uint8Array): RomDependencyList {
  if (bytes.length < HEADER_BYTES) throw new RomDependencyListError("truncated header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 8)) !== MAGIC) throw new RomDependencyListError("bad magic");
  const version = view.getUint16(8, true);
  if (version !== VERSION) throw new RomDependencyListError(`unsupported format version ${version}`);
  if (view.getUint16(10, true) !== HEADER_BYTES)
    throw new RomDependencyListError(`header_bytes must be ${HEADER_BYTES}`);

  // §5.3: header CRC-32 is taken with its own field as zero.
  const headerCopy = Uint8Array.from(bytes.subarray(0, HEADER_BYTES));
  new DataView(headerCopy.buffer).setUint32(52, 0, true);
  if (crc32(headerCopy) !== view.getUint32(52, true)) throw new RomDependencyListError("header CRC-32 mismatch");

  const flags = view.getUint32(12, true);
  if (flags & ~FLAG_INCOMPLETE_SOURCE) throw new RomDependencyListError("unknown flag bits set");
  if (view.getUint16(62, true) !== 0) throw new RomDependencyListError("reserved field is not zero");
  const listingCeiling = bytes[60];
  if (listingCeiling < 1 || listingCeiling > MAX_LISTING_CEILING) {
    throw new RomDependencyListError(`listing_ceiling must be 1..${MAX_LISTING_CEILING}`);
  }
  const recommendedMinGrade = bytes[61];
  if (recommendedMinGrade < 1 || recommendedMinGrade > listingCeiling + 1) {
    throw new RomDependencyListError("recommended_min_grade must be 1..listing_ceiling+1");
  }
  const hvscRelease = view.getUint32(16, true);
  if (hvscRelease < 1) throw new RomDependencyListError("hvsc_release must be >= 1");
  if (view.getUint16(56, true) !== FILE_RECORD_BYTES || view.getUint16(58, true) !== DECISION_RECORD_BYTES) {
    throw new RomDependencyListError("unsupported record sizes");
  }

  // §5.2: offsets and lengths are redundant with the counts and must equal the canonical values.
  const fileCount = view.getUint32(28, true);
  const decisionCount = view.getUint32(32, true);
  const fileBytes = fileCount * FILE_RECORD_BYTES;
  const decisionBytes = decisionCount * DECISION_RECORD_BYTES;
  const decisionOffset = HEADER_BYTES + fileBytes;
  if (
    view.getUint32(36, true) !== HEADER_BYTES ||
    view.getUint32(40, true) !== fileBytes ||
    view.getUint32(44, true) !== decisionOffset ||
    view.getUint32(48, true) !== decisionBytes
  ) {
    throw new RomDependencyListError("section offsets or lengths are not the canonical tightly packed layout");
  }
  if (bytes.length < decisionOffset + decisionBytes) throw new RomDependencyListError("truncated payload");
  if (bytes.length > decisionOffset + decisionBytes)
    throw new RomDependencyListError("trailing bytes after the last section");
  const payloadSha256 = hexOf(bytes.subarray(64, 96));
  if (sha256Hex(bytes.subarray(HEADER_BYTES)) !== payloadSha256)
    throw new RomDependencyListError("payload SHA-256 mismatch");

  // §6: strictly ascending MD5s; §6/§7: the per-file counts select each file's decisions by prefix sum.
  const firstDecision = new Uint32Array(fileCount + 1);
  let running = 0;
  for (let i = 0; i < fileCount; i++) {
    const at = HEADER_BYTES + i * FILE_RECORD_BYTES;
    if (i > 0 && compareMd5(bytes, at, bytes.subarray(at - FILE_RECORD_BYTES, at - FILE_RECORD_BYTES + 16)) <= 0) {
      throw new RomDependencyListError(`file records are not strictly ascending at index ${i}`);
    }
    firstDecision[i] = running;
    running += bytes[at + 16] + 1;
  }
  firstDecision[fileCount] = running;
  if (running !== decisionCount)
    throw new RomDependencyListError("per-file decision counts do not sum to decision_count");

  // §7: ascending subtunes per file; every record must have a lane at or below the listing ceiling.
  for (let i = 0; i < fileCount; i++) {
    let previous = 0;
    for (let d = firstDecision[i]; d < firstDecision[i + 1]; d++) {
      const at = decisionOffset + d * DECISION_RECORD_BYTES;
      const subtune = bytes[at] + 1;
      if (subtune <= previous) throw new RomDependencyListError(`file ${i}: subtunes are not strictly ascending`);
      if (Math.min(bytes[at + 1], bytes[at + 2], bytes[at + 3], bytes[at + 4]) > listingCeiling) {
        throw new RomDependencyListError(
          `file ${i}: every lane is above the listing ceiling, so the subtune must be unlisted`,
        );
      }
      previous = subtune;
    }
  }

  const find = (key: Uint8Array): number => {
    let low = 0;
    let high = fileCount - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cmp = compareMd5(bytes, HEADER_BYTES + mid * FILE_RECORD_BYTES, key);
      if (cmp === 0) return mid;
      if (cmp < 0) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  };

  return {
    header: {
      hvscRelease,
      incompleteSource: (flags & FLAG_INCOMPLETE_SOURCE) !== 0,
      fileCount,
      decisionCount,
      listingCeiling,
      recommendedMinGrade,
      payloadSha256,
    },
    lookup(md5, subtune) {
      const floor = listingCeiling + 1;
      const unlisted: RomDepLookup = {
        listed: false,
        grades: { sidliteNone: floor, sidliteKernalBasic: floor, residfpNone: floor, residfpKernalBasic: floor },
      };
      // §8: a subtune outside 1..256 is unlisted; matching is on all 16 bytes, never a prefix.
      if (!Number.isInteger(subtune) || subtune < 1 || subtune > MAX_SUBTUNE) return unlisted;
      const index = find(md5ToBytes(md5));
      if (index < 0) return unlisted;
      for (let d = firstDecision[index]; d < firstDecision[index + 1]; d++) {
        const at = decisionOffset + d * DECISION_RECORD_BYTES;
        if (bytes[at] + 1 === subtune) {
          return {
            listed: true,
            grades: {
              sidliteNone: bytes[at + 1],
              sidliteKernalBasic: bytes[at + 2],
              residfpNone: bytes[at + 3],
              residfpKernalBasic: bytes[at + 4],
            },
          };
        }
      }
      return unlisted;
    },
  };
}
