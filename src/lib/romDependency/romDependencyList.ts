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
 * The list names the HVSC tunes that were measured to sound different when the C64's own ROMs are
 * missing. It is allow-by-default: a tune that is not listed is simply playable. The specification
 * is `doc/rom-dependency-list.md` in https://github.com/chrisgleissner/sidflow; section numbers in
 * the comments below refer to it. The reference decoder is
 * `packages/sidflow-common/src/rom-dependency-list.ts` in the same repository. This is a port of
 * the reading half only, so that Commander does not depend on any sidflow package.
 */

import { crc32, sha256Hex } from "./digest";

const MAGIC = "SIDROMDP";
const VERSION = 1;
const HEADER_BYTES = 192;
const FILE_RECORD_BYTES = 17;
const DECISION_RECORD_BYTES = 2;
const FLAG_INCOMPLETE_SOURCE = 0x1;
const MAX_SUBTUNE = 256;

/** §5.5: lane bits. A lane is one (engine, ROM configuration) pair. */
export const ROM_DEP_LANE_BITS = {
  sidliteNone: 1,
  sidliteKernalBasic: 2,
  residfpNone: 4,
  residfpKernalBasic: 8,
} as const;
export type RomDepLaneName = keyof typeof ROM_DEP_LANE_BITS;

/** `allowed` is the default for a lane that is neither incompatible nor unknown. It is not a compatibility proof. */
export type RomDepLaneState = "allowed" | "incompatible" | "unknown";

export interface RomDepLookup {
  /** True when the (file, subtune) has a record. Unlisted means "no objection", not "compatible" (§10.3). */
  listed: boolean;
  incompatibleMask: number;
  unknownMask: number;
}

export interface RomDepHeader {
  hvscRelease: number;
  /** §5.4 bit 0: a developer artefact that a product must not embed. */
  incompleteSource: boolean;
  fileCount: number;
  decisionCount: number;
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

/** The state of one lane in a lookup result (§7: a lane has exactly one state). */
export const laneState = (lookup: RomDepLookup, lane: RomDepLaneName): RomDepLaneState => {
  const bit = ROM_DEP_LANE_BITS[lane];
  if (lookup.incompatibleMask & bit) return "incompatible";
  if (lookup.unknownMask & bit) return "unknown";
  return "allowed";
};

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
 * impossible masks. A caller never receives a partial list.
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
  if (view.getUint32(60, true) !== 0) throw new RomDependencyListError("reserved field is not zero");
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

  // §7: ascending subtunes per file; a lane has exactly one state; a record must say something.
  for (let i = 0; i < fileCount; i++) {
    let previous = 0;
    for (let d = firstDecision[i]; d < firstDecision[i + 1]; d++) {
      const at = decisionOffset + d * DECISION_RECORD_BYTES;
      const subtune = bytes[at] + 1;
      const incompatible = bytes[at + 1] & 0xf;
      const unknown = bytes[at + 1] >> 4;
      if (subtune <= previous) throw new RomDependencyListError(`file ${i}: subtunes are not strictly ascending`);
      if (incompatible & unknown)
        throw new RomDependencyListError(`file ${i}: a lane cannot be both incompatible and unknown`);
      if ((incompatible | unknown) === 0)
        throw new RomDependencyListError(`file ${i}: record carries no non-default lane`);
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
      payloadSha256,
    },
    lookup(md5, subtune) {
      const unlisted: RomDepLookup = { listed: false, incompatibleMask: 0, unknownMask: 0 };
      // §8: a subtune outside 1..256 is unlisted; matching is on all 16 bytes, never a prefix.
      if (!Number.isInteger(subtune) || subtune < 1 || subtune > MAX_SUBTUNE) return unlisted;
      const index = find(md5ToBytes(md5));
      if (index < 0) return unlisted;
      for (let d = firstDecision[index]; d < firstDecision[index + 1]; d++) {
        const at = decisionOffset + d * DECISION_RECORD_BYTES;
        if (bytes[at] + 1 === subtune) {
          return { listed: true, incompatibleMask: bytes[at + 1] & 0xf, unknownMask: bytes[at + 1] >> 4 };
        }
      }
      return unlisted;
    },
  };
}
