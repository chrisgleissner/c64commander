/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Parser + cold→hot transform for the `sidcorr-tiny-1` similarity bundle
 * (see `sidflow/doc/similarity-export-tiny.md`).
 *
 * The on-disk layout is optimised for small cold storage (bit-packed u24
 * neighbour ordinals, raw 6-byte MD5 prefixes, u16 masks) — not for fast hot
 * random access. So at load we perform a **one-time** transform (spec §2.6):
 *
 *   - expand u24 neighbour targets → an aligned `Uint32Array`
 *   - build the reverse CSR once (edges pointing *into* each track)
 *   - build a `md5_48 → fileOrdinal` map for O(1) seed resolution
 *
 * This is a pure function of the input `ArrayBuffer` — no DOM, no globals — so
 * it runs identically in the worker, in Node unit tests, and in any WebView.
 */

const MAGIC = "SIDTINY1";
const HEADER_BYTES = 64;
const NEIGHBORS_PER_TRACK = 3;
const STYLE_MASK_WIDTH_BYTES = 2;
const COMPACT_RATING_BYTES = 2;
const MD5_48_BYTES = 6;

/** On-disk unused-neighbour sentinel (u24). */
const RAW_EMPTY_NEIGHBOR = 0xffffff;
/** Hot (Uint32Array) unused-neighbour sentinel. */
export const EMPTY_NEIGHBOR_HOT = 0xffffffff;

/**
 * `graph_flags` bit 0 — the exported edges form a directed acyclic graph.
 *
 * Set by 0.8.0 and earlier, and **cleared from 0.8.2 onward**: acyclicity encoded a playback
 * policy ("never play the same tune twice") as a constraint on the artefact, and enforcing it
 * cost 50.76% of the source graph's edges. Not revisiting a track is the player's job, and
 * {@link StationQueueProvider} already keeps the set that does it.
 *
 * Exposed so the flag can be *reported*, never so a traversal can rely on it. `computeStation`'s
 * walk is bounded by `maxHops` and a frontier cap, so it terminates on a cyclic graph as readily
 * as on an acyclic one.
 */
export const GRAPH_FLAG_ACYCLIC = 1 << 0;

/**
 * `graph_flags` bit 3 — slot 0 of every populated row is the track's flow successor.
 *
 * Retired upstream. It declared a Hamiltonian path through the exported edges and was set only
 * by a 0.8.2 build that was withdrawn within days; no published bundle sets it. The constant
 * exists so that a bundle which *does* set it can be recognised rather than silently
 * misinterpreted — slot 0 in every published bundle is the closest neighbour, not a successor.
 */
export const GRAPH_FLAG_FLOW_SUCCESSOR_FIRST = 1 << 3;

/**
 * `graph_flags` bits 1 and 2 — written since the format's first release and never assigned a
 * meaning. Preserved by the generator rather than cleared, so they carry no information.
 */
export const GRAPH_FLAG_RESERVED_LEGACY = (1 << 1) | (1 << 2);

export type SidcorrStyleKind = "audio" | "metadata" | "hybrid";

export interface SidcorrStyle {
  /** Machine key, e.g. `fast_paced`. */
  key: string;
  /** Human label from the export, e.g. `Fast Paced`. */
  label: string;
  /** Classifier kind. */
  kind: SidcorrStyleKind;
  /** Style-mask bit index (equals the style ordinal). */
  maskBit: number;
}

export interface SidcorrResolvedTrack {
  fileOrdinal: number;
  /**
   * Which tune of the file this ordinal is, counting from 1.
   *
   * One-based, like every other tune number the app holds, and deliberately not called an index:
   * the engine's own `songIndex` counts from 0, and conflating the two played the wrong tune. See
   * `sidTuneIndex` for the single place that converts.
   */
  songNr: number;
  /** 12-hex-char md5_48 file identity. */
  md5_48: string;
}

export interface SidcorrTinyStats {
  bundleBytes: number;
  /** Total non-sentinel forward edges (== reverse CSR edge count). */
  edgeCount: number;
  /** Estimated resident bytes of the transformed hot structures. */
  memoryEstimateBytes: number;
  /** Wall-clock ms spent in `parseSidcorrTiny` (observability, §9.4). */
  bundleLoadMs: number;
  /** Wall-clock ms of the reverse-index build portion. */
  reverseIndexMs: number;
}

export class SidcorrParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SidcorrParseError";
    this.code = code;
  }
}

export interface SidcorrTinyBundle {
  version: number;
  /**
   * Raw `graph_flags` u16 from header offset 30, reported rather than acted on.
   *
   * The format requires consumers to ignore bits they do not recognise, so this is deliberately
   * the unmasked value: nothing here gates parsing or traversal, and an unknown bit changes
   * nothing. See {@link GRAPH_FLAG_ACYCLIC} and {@link GRAPH_FLAG_FLOW_SUCCESSOR_FIRST}.
   */
  graphFlags: number;
  fileCount: number;
  trackCount: number;
  styles: SidcorrStyle[];

  /** [trackCount * 3] neighbour target ordinals; {@link EMPTY_NEIGHBOR_HOT} = unused. */
  neighborTargets: Uint32Array;
  /** [trackCount * 3] quantized similarity byte per edge (0 in v1 / for empty slots). */
  neighborSimilarity: Uint8Array;
  /** [trackCount] style membership bitmask. */
  styleMask: Uint16Array;
  /** [trackCount] packed compact ratings (0 when absent, i.e. v1). */
  ratings: Uint16Array;
  /** [fileCount + 1] prefix sums of per-file subsong counts. */
  fileTrackStart: Uint32Array;
  /** md5_48 hex per file ordinal. */
  md548ByFileOrdinal: string[];
  /** md5_48 hex → file ordinal (O(1) seed resolution). */
  md548ToFileOrdinal: Map<string, number>;

  /** [trackCount + 1] reverse-CSR offsets. */
  reverseOffset: Uint32Array;
  /** [edgeCount] reverse-CSR source ordinals (tracks whose forward edge points here). */
  reverseSource: Uint32Array;
  /** [edgeCount] similarity parallel to {@link reverseSource}. */
  reverseSimilarity: Uint8Array;

  stats: SidcorrTinyStats;

  /** Resolve a track ordinal to its (fileOrdinal, songNr, md5_48). */
  resolveTrack(ordinal: number): SidcorrResolvedTrack;
  /** All track ordinals belonging to a file identity (empty if unknown). */
  trackOrdinalsForMd548(md5_48: string): number[];
  /** Source ordinals of every forward edge that points at `ordinal`. */
  reverseSourcesOf(ordinal: number): Uint32Array;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const kindFromByte = (value: number): SidcorrStyleKind => (value === 0 ? "audio" : value === 1 ? "metadata" : "hybrid");

const readAscii = (view: DataView, offset: number, length: number): string => {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
};

const toHex = (view: DataView, offset: number, length: number): string => {
  let out = "";
  for (let i = 0; i < length; i += 1)
    out += view
      .getUint8(offset + i)
      .toString(16)
      .padStart(2, "0");
  return out;
};

const requireInBounds = (label: string, offset: number, length: number, byteLength: number) => {
  if (offset < 0 || length < 0 || offset + length > byteLength) {
    throw new SidcorrParseError(
      "out-of-bounds",
      `section ${label} (offset ${offset}, length ${length}) is out of bounds for the ${byteLength}-byte bundle`,
    );
  }
};

const parseStyleTable = (
  view: DataView,
  styleTableOffset: number,
  styleTableBytes: number,
  styleCount: number,
): SidcorrStyle[] => {
  const sectionEnd = styleTableOffset + styleTableBytes;
  const recordBytes = view.getUint16(styleTableOffset + 4, true);
  const payloadBytes = view.getUint32(styleTableOffset + 8, true);
  const recordStart = styleTableOffset + 12;
  const payloadStart = recordStart + recordBytes * styleCount;
  requireInBounds("STYLE_TABLE.payload", payloadStart, payloadBytes, view.byteLength);
  if (payloadStart + payloadBytes > sectionEnd) {
    throw new SidcorrParseError("style-table", "STYLE_TABLE payload overruns the declared section length");
  }
  const decoder = new TextDecoder();
  const bytesAt = (offset: number, length: number) =>
    new Uint8Array(view.buffer, view.byteOffset + payloadStart + offset, length);
  const styles: SidcorrStyle[] = [];
  for (let i = 0; i < styleCount; i += 1) {
    const rs = recordStart + i * recordBytes;
    const maskBit = view.getUint8(rs + 1);
    const kind = kindFromByte(view.getUint8(rs + 2));
    const keyOffset = view.getUint32(rs + 8, true);
    const keyLength = view.getUint16(rs + 12, true);
    const labelOffset = view.getUint32(rs + 14, true);
    const labelLength = view.getUint16(rs + 18, true);
    styles.push({
      key: decoder.decode(bytesAt(keyOffset, keyLength)),
      label: decoder.decode(bytesAt(labelOffset, labelLength)),
      kind,
      maskBit,
    });
  }
  return styles;
};

export const parseSidcorrTiny = (buffer: ArrayBuffer): SidcorrTinyBundle => {
  const startedAt = now();
  if (buffer.byteLength < HEADER_BYTES) {
    throw new SidcorrParseError("truncated", `bundle is ${buffer.byteLength} bytes, need at least ${HEADER_BYTES}`);
  }
  const view = new DataView(buffer);

  if (readAscii(view, 0, 8) !== MAGIC) {
    throw new SidcorrParseError("magic", "not a sidcorr-tiny-1 bundle (bad magic)");
  }
  const version = view.getUint16(8, true);
  if (version !== 1 && version !== 2) {
    throw new SidcorrParseError("version", `unsupported sidcorr-tiny-1 binary version ${version}`);
  }

  const trackCount = view.getUint32(12, true);
  const fileCount = view.getUint32(16, true);
  const styleCount = view.getUint16(20, true);
  const neighborsPerTrack = view.getUint16(22, true);
  // Header bytes 24..29 are unassigned; `graph_flags` is the u16 at 30. Read unmasked and never
  // branched on — the format's rule is that unrecognised bits are ignored, and the bits that do
  // have meanings (acyclic, flow-successor) are declarations the traversal must not depend on.
  const graphFlags = view.getUint16(30, true);
  if (neighborsPerTrack !== NEIGHBORS_PER_TRACK) {
    throw new SidcorrParseError(
      "neighbors",
      `expected ${NEIGHBORS_PER_TRACK} neighbours per track, got ${neighborsPerTrack}`,
    );
  }

  const styleTableOffset = view.getUint32(32, true);
  const fileIdentityOffset = view.getUint32(36, true);
  const fileTrackCountOffset = view.getUint32(40, true);
  const styleMaskOffset = view.getUint32(44, true);
  const neighborsOffset = view.getUint32(48, true);
  const styleTableBytes = view.getUint32(52, true);
  const fileIdentityBytes = view.getUint32(56, true);
  const neighborsBytes = view.getUint32(60, true);

  const styleMaskBytes = trackCount * STYLE_MASK_WIDTH_BYTES;
  const packedRatingBytes = trackCount * COMPACT_RATING_BYTES;

  requireInBounds("STYLE_TABLE", styleTableOffset, styleTableBytes, buffer.byteLength);
  requireInBounds("FILE_IDENTITY_TABLE", fileIdentityOffset, fileIdentityBytes, buffer.byteLength);
  requireInBounds("FILE_TRACK_COUNT_TABLE", fileTrackCountOffset, fileCount, buffer.byteLength);
  requireInBounds("STYLE_MASK_TABLE", styleMaskOffset, styleMaskBytes, buffer.byteLength);
  requireInBounds("NEIGHBOR_TABLE", neighborsOffset, neighborsBytes, buffer.byteLength);

  if (fileIdentityBytes !== fileCount * MD5_48_BYTES) {
    throw new SidcorrParseError(
      "file-identity",
      `FILE_IDENTITY_TABLE is ${fileIdentityBytes} bytes, expected ${fileCount * MD5_48_BYTES} (md5_48 mode)`,
    );
  }

  const hasNeighborSimilarity = version >= 2 && neighborsBytes === trackCount * NEIGHBORS_PER_TRACK * 4;
  const neighborRecordBytes = hasNeighborSimilarity ? 4 : 3;
  if (neighborsBytes !== trackCount * NEIGHBORS_PER_TRACK * neighborRecordBytes) {
    throw new SidcorrParseError(
      "neighbor-table",
      `NEIGHBOR_TABLE is ${neighborsBytes} bytes, expected ${trackCount * NEIGHBORS_PER_TRACK * neighborRecordBytes}`,
    );
  }
  const hasPackedRatings = version >= 2 && neighborsOffset === styleMaskOffset + styleMaskBytes + packedRatingBytes;

  const styles = parseStyleTable(view, styleTableOffset, styleTableBytes, styleCount);

  // --- file identity ---
  const md548ByFileOrdinal: string[] = new Array(fileCount);
  const md548ToFileOrdinal = new Map<string, number>();
  for (let f = 0; f < fileCount; f += 1) {
    const hex = toHex(view, fileIdentityOffset + f * MD5_48_BYTES, MD5_48_BYTES);
    md548ByFileOrdinal[f] = hex;
    md548ToFileOrdinal.set(hex, f);
  }

  // --- file → track prefix sums ---
  const fileTrackStart = new Uint32Array(fileCount + 1);
  let running = 0;
  for (let f = 0; f < fileCount; f += 1) {
    fileTrackStart[f] = running;
    running += view.getUint8(fileTrackCountOffset + f) + 1;
  }
  fileTrackStart[fileCount] = running;
  if (running !== trackCount) {
    throw new SidcorrParseError(
      "track-count",
      `sum of per-file subsong counts (${running}) != header track_count (${trackCount})`,
    );
  }

  // --- style masks (aligned copy) ---
  const styleMask = new Uint16Array(trackCount);
  for (let t = 0; t < trackCount; t += 1) styleMask[t] = view.getUint16(styleMaskOffset + t * 2, true);

  // --- ratings (aligned copy; zero when absent) ---
  const ratings = new Uint16Array(trackCount);
  if (hasPackedRatings) {
    const ratingOffset = styleMaskOffset + styleMaskBytes;
    for (let t = 0; t < trackCount; t += 1) ratings[t] = view.getUint16(ratingOffset + t * 2, true);
  }

  // --- neighbours: expand u24 → Uint32 (cold→hot) ---
  const neighborTargets = new Uint32Array(trackCount * NEIGHBORS_PER_TRACK);
  const neighborSimilarity = new Uint8Array(trackCount * NEIGHBORS_PER_TRACK);
  let edgeCount = 0;
  for (let t = 0; t < trackCount; t += 1) {
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const flatIndex = t * NEIGHBORS_PER_TRACK + slot;
      const recordOffset = neighborsOffset + flatIndex * neighborRecordBytes;
      const raw =
        view.getUint8(recordOffset) | (view.getUint8(recordOffset + 1) << 8) | (view.getUint8(recordOffset + 2) << 16);
      if (raw === RAW_EMPTY_NEIGHBOR || raw >= trackCount) {
        neighborTargets[flatIndex] = EMPTY_NEIGHBOR_HOT;
        continue;
      }
      neighborTargets[flatIndex] = raw;
      neighborSimilarity[flatIndex] = hasNeighborSimilarity ? view.getUint8(recordOffset + 3) : 0;
      edgeCount += 1;
    }
  }

  // --- reverse CSR (built once, §2.3 step 1) ---
  const reverseStartedAt = now();
  const reverseOffset = new Uint32Array(trackCount + 1);
  for (let i = 0; i < neighborTargets.length; i += 1) {
    const target = neighborTargets[i];
    if (target !== EMPTY_NEIGHBOR_HOT) reverseOffset[target + 1] += 1;
  }
  for (let t = 0; t < trackCount; t += 1) reverseOffset[t + 1] += reverseOffset[t];
  const reverseSource = new Uint32Array(edgeCount);
  const reverseSimilarity = new Uint8Array(edgeCount);
  const cursor = Uint32Array.from(reverseOffset.subarray(0, trackCount));
  for (let t = 0; t < trackCount; t += 1) {
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const flatIndex = t * NEIGHBORS_PER_TRACK + slot;
      const target = neighborTargets[flatIndex];
      if (target === EMPTY_NEIGHBOR_HOT) continue;
      const writeAt = cursor[target];
      cursor[target] += 1;
      reverseSource[writeAt] = t;
      reverseSimilarity[writeAt] = neighborSimilarity[flatIndex];
    }
  }
  const reverseIndexMs = now() - reverseStartedAt;

  const memoryEstimateBytes =
    neighborTargets.byteLength +
    neighborSimilarity.byteLength +
    styleMask.byteLength +
    ratings.byteLength +
    fileTrackStart.byteLength +
    reverseOffset.byteLength +
    reverseSource.byteLength +
    reverseSimilarity.byteLength +
    fileCount * (MD5_48_BYTES * 2 + 16); // rough allowance for md5 hex strings + map entries

  const bundleLoadMs = now() - startedAt;

  return {
    version,
    graphFlags,
    fileCount,
    trackCount,
    styles,
    neighborTargets,
    neighborSimilarity,
    styleMask,
    ratings,
    fileTrackStart,
    md548ByFileOrdinal,
    md548ToFileOrdinal,
    reverseOffset,
    reverseSource,
    reverseSimilarity,
    stats: { bundleBytes: buffer.byteLength, edgeCount, memoryEstimateBytes, bundleLoadMs, reverseIndexMs },
    resolveTrack(ordinal: number): SidcorrResolvedTrack {
      if (ordinal < 0 || ordinal >= trackCount) {
        throw new SidcorrParseError("ordinal", `track ordinal ${ordinal} out of range [0, ${trackCount})`);
      }
      // upper_bound(fileTrackStart, ordinal) - 1
      let lo = 0;
      let hi = fileCount;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (fileTrackStart[mid] <= ordinal) lo = mid + 1;
        else hi = mid;
      }
      const fileOrdinal = lo - 1;
      return {
        fileOrdinal,
        songNr: ordinal - fileTrackStart[fileOrdinal] + 1,
        md5_48: md548ByFileOrdinal[fileOrdinal],
      };
    },
    trackOrdinalsForMd548(md5_48: string): number[] {
      const fileOrdinal = md548ToFileOrdinal.get(md5_48.toLowerCase());
      if (fileOrdinal === undefined) return [];
      const start = fileTrackStart[fileOrdinal];
      const end = fileTrackStart[fileOrdinal + 1];
      const out: number[] = [];
      for (let t = start; t < end; t += 1) out.push(t);
      return out;
    },
    reverseSourcesOf(ordinal: number): Uint32Array {
      if (ordinal < 0 || ordinal >= trackCount) return new Uint32Array(0);
      return reverseSource.subarray(reverseOffset[ordinal], reverseOffset[ordinal + 1]);
    },
  };
};
