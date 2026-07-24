/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Synthetic `sidcorr-tiny-1` bundle builder for unit tests.
 *
 * Emits a tiny, byte-exact `.sidcorr` (binary_format_version 1 or 2) from a
 * declarative spec, so tests never load the 1.8 MB real bundle and every
 * assertion is exact. The layout mirrors the SIDFlow generator / the normative
 * spec `sidflow/doc/similarity-export-tiny.md`:
 *
 *   Header (64B) | STYLE_TABLE | FILE_IDENTITY_TABLE | FILE_TRACK_COUNT_TABLE |
 *   STYLE_MASK_TABLE | [RATING_TABLE (v2)] | NEIGHBOR_TABLE
 *
 * Track ordinals follow file order then subsong order (sidcorr-1 ordering).
 * Neighbor targets MUST reference a strictly smaller ordinal (acyclic DAG);
 * unused slots are the 0xFFFFFF sentinel.
 */

/** The 9 canonical styles the real export ships, in mask-bit order. */
export const DEFAULT_TINY_STYLES: TinyFixtureStyle[] = [
  { key: "fast_paced", label: "Fast Paced", kind: "audio" },
  { key: "slow_ambient", label: "Slow / Ambient", kind: "audio" },
  { key: "melodic", label: "Melodic", kind: "audio" },
  { key: "experimental", label: "Experimental", kind: "audio" },
  { key: "nostalgic", label: "Nostalgic", kind: "audio" },
  { key: "composer_focus", label: "Composer Focus", kind: "hybrid" },
  { key: "era_explorer", label: "Era Explorer", kind: "hybrid" },
  { key: "deep_discovery", label: "Deep Discovery", kind: "hybrid" },
  { key: "theme_hunter", label: "Theme Hunter", kind: "hybrid" },
];

export const SIDTINY_MAGIC = "SIDTINY1";
export const SIDTINY_HEADER_BYTES = 64;
export const SIDTINY_EMPTY_NEIGHBOR = 0xffffff;

export type TinyStyleKind = "audio" | "metadata" | "hybrid";

export interface TinyFixtureStyle {
  key: string;
  label: string;
  kind: TinyStyleKind;
}

export interface TinyFixtureNeighbor {
  /** Target track ordinal — MUST be strictly smaller than this track's ordinal. */
  target: number;
  /** Cosine similarity in [-1, 1]; quantized to a byte in v2 (ignored in v1). */
  similarity?: number;
}

export interface TinyFixtureTrack {
  /** Style membership bitmask (bit i = style i). Default 0. */
  styleMask?: number;
  /** Compact ratings (each 0..15; p null/absent → stored as 0 → decodes to null). */
  ratings?: { e: number; m: number; c: number; p?: number | null };
  /** Up to 3 backward neighbor edges (bare ordinals or {target, similarity}). */
  neighbors?: Array<number | TinyFixtureNeighbor>;
}

export interface TinyFixtureFile {
  /** 12 hex chars (6-byte md5_48). Auto-derived from the file index if omitted. */
  md5_48?: string;
  tracks: TinyFixtureTrack[];
}

export interface TinyFixtureSpec {
  /** Binary format version to emit. Default 2 (adds similarity byte + rating table). */
  version?: 1 | 2;
  /** Style table (default the 9 canonical styles). */
  styles?: TinyFixtureStyle[];
  files: TinyFixtureFile[];
}

const NEIGHBORS_PER_TRACK = 3;
const STYLE_RECORD_BYTES = 28;
const STYLE_TABLE_VERSION = 1;

const kindByte = (kind: TinyStyleKind) => (kind === "audio" ? 0 : kind === "metadata" ? 1 : 2);
const derivationByte = (kind: TinyStyleKind) => (kind === "audio" ? 0 : kind === "metadata" ? 2 : 3);

/** Deterministic md5_48 for a file index when none is supplied (12 hex chars). */
export const deriveMd548 = (fileIndex: number): string => {
  // Spread the index across the 6 bytes so distinct files get distinct prefixes.
  const hi = ((fileIndex * 2654435761) >>> 0).toString(16).padStart(8, "0");
  const lo = ((fileIndex * 40503 + 7) & 0xffff).toString(16).padStart(4, "0");
  return (hi + lo).slice(0, 12);
};

const hexToBytes = (hex: string): Uint8Array => {
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) {
    throw new Error(`buildTinyFixture: md5_48 must be 12 hex chars, got "${hex}"`);
  }
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const clampNibble = (value: number) => Math.max(0, Math.min(15, Math.round(value)));

const packRatings = (ratings?: TinyFixtureTrack["ratings"]): number => {
  if (!ratings) return 0;
  const e = clampNibble(ratings.e);
  const m = clampNibble(ratings.m);
  const c = clampNibble(ratings.c);
  const p = ratings.p == null ? 0 : clampNibble(ratings.p);
  return (e | (m << 4) | (c << 8) | (p << 12)) & 0xffff;
};

const encodeSimilarity = (similarity: number) => Math.max(0, Math.min(255, Math.round(((similarity + 1) / 2) * 255)));

const buildStyleTable = (styles: TinyFixtureStyle[]): Uint8Array => {
  const encoder = new TextEncoder();
  const records: Uint8Array[] = [];
  const payloads: Uint8Array[] = [];
  let payloadOffset = 0;
  styles.forEach((style, index) => {
    const keyBuf = encoder.encode(style.key);
    const labelBuf = encoder.encode(style.label);
    const configBuf = encoder.encode(JSON.stringify({ kind: style.kind }));
    const record = new Uint8Array(STYLE_RECORD_BYTES);
    const view = new DataView(record.buffer);
    view.setUint8(0, index);
    view.setUint8(1, index);
    view.setUint8(2, kindByte(style.kind));
    view.setUint8(3, derivationByte(style.kind));
    view.setUint32(4, 0, true);
    view.setUint32(8, payloadOffset, true);
    view.setUint16(12, keyBuf.length, true);
    payloadOffset += keyBuf.length;
    view.setUint32(14, payloadOffset, true);
    view.setUint16(18, labelBuf.length, true);
    payloadOffset += labelBuf.length;
    view.setUint32(20, payloadOffset, true);
    view.setUint16(24, configBuf.length, true);
    view.setUint16(26, 0, true);
    payloadOffset += configBuf.length;
    records.push(record);
    payloads.push(keyBuf, labelBuf, configBuf);
  });

  const sectionHeader = new Uint8Array(12);
  const shView = new DataView(sectionHeader.buffer);
  shView.setUint16(0, STYLE_TABLE_VERSION, true);
  shView.setUint16(2, styles.length, true);
  shView.setUint16(4, STYLE_RECORD_BYTES, true);
  shView.setUint16(6, 0, true);
  shView.setUint32(8, payloadOffset, true);
  return concatBytes([sectionHeader, ...records, ...payloads]);
};

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/** Build a byte-exact synthetic `.sidcorr` bundle as an ArrayBuffer. */
export const buildTinyFixture = (spec: TinyFixtureSpec): ArrayBuffer => {
  const version = spec.version ?? 2;
  const styles = spec.styles ?? DEFAULT_TINY_STYLES;
  const files = spec.files;
  if (files.length === 0) throw new Error("buildTinyFixture: at least one file is required");

  const fileCount = files.length;
  const trackCount = files.reduce((sum, file) => sum + file.tracks.length, 0);
  if (trackCount === 0) throw new Error("buildTinyFixture: at least one track is required");

  // Flatten tracks in file-then-subsong order (sidcorr-1 ordering).
  const flatTracks: TinyFixtureTrack[] = [];
  for (const file of files) {
    if (file.tracks.length === 0) throw new Error("buildTinyFixture: every file needs >= 1 track");
    for (const track of file.tracks) flatTracks.push(track);
  }

  const styleTable = buildStyleTable(styles);

  const fileIdentity = new Uint8Array(fileCount * 6);
  files.forEach((file, index) => {
    fileIdentity.set(hexToBytes(file.md5_48 ?? deriveMd548(index)), index * 6);
  });

  const fileTrackCount = new Uint8Array(fileCount);
  files.forEach((file, index) => {
    fileTrackCount[index] = Math.max(0, file.tracks.length - 1);
  });

  const styleMask = new Uint8Array(trackCount * 2);
  const styleMaskView = new DataView(styleMask.buffer);
  flatTracks.forEach((track, ordinal) => {
    styleMaskView.setUint16(ordinal * 2, (track.styleMask ?? 0) & 0xffff, true);
  });

  const ratingTable = new Uint8Array(trackCount * 2);
  const ratingView = new DataView(ratingTable.buffer);
  flatTracks.forEach((track, ordinal) => {
    ratingView.setUint16(ordinal * 2, packRatings(track.ratings), true);
  });

  const neighborRecordBytes = version >= 2 ? 4 : 3;
  const neighborTable = new Uint8Array(trackCount * NEIGHBORS_PER_TRACK * neighborRecordBytes);
  flatTracks.forEach((track, ordinal) => {
    const edges = (track.neighbors ?? []).map((edge) =>
      typeof edge === "number" ? { target: edge, similarity: undefined } : edge,
    );
    if (edges.length > NEIGHBORS_PER_TRACK) {
      throw new Error(`buildTinyFixture: track ${ordinal} has > ${NEIGHBORS_PER_TRACK} neighbors`);
    }
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const edge = edges[slot];
      const recordOffset = (ordinal * NEIGHBORS_PER_TRACK + slot) * neighborRecordBytes;
      const target = edge ? edge.target : SIDTINY_EMPTY_NEIGHBOR;
      if (edge && (target >= ordinal || target < 0)) {
        throw new Error(
          `buildTinyFixture: neighbor target ${target} of track ${ordinal} must be a smaller, non-negative ordinal (acyclic DAG)`,
        );
      }
      neighborTable[recordOffset] = target & 0xff;
      neighborTable[recordOffset + 1] = (target >>> 8) & 0xff;
      neighborTable[recordOffset + 2] = (target >>> 16) & 0xff;
      if (version >= 2) {
        neighborTable[recordOffset + 3] = edge ? encodeSimilarity(edge.similarity ?? 0.8 - slot * 0.05) : 0;
      }
    }
  });

  const styleTableOffset = SIDTINY_HEADER_BYTES;
  const fileIdentityOffset = styleTableOffset + styleTable.length;
  const fileTrackCountOffset = fileIdentityOffset + fileIdentity.length;
  const styleMaskOffset = fileTrackCountOffset + fileTrackCount.length;
  const ratingBytes = version >= 2 ? ratingTable.length : 0;
  const neighborsOffset = styleMaskOffset + styleMask.length + ratingBytes;

  const header = new Uint8Array(SIDTINY_HEADER_BYTES);
  const headerView = new DataView(header.buffer);
  for (let i = 0; i < SIDTINY_MAGIC.length; i += 1) headerView.setUint8(i, SIDTINY_MAGIC.charCodeAt(i));
  headerView.setUint16(8, version, true);
  headerView.setUint16(10, SIDTINY_HEADER_BYTES, true);
  headerView.setUint32(12, trackCount, true);
  headerView.setUint32(16, fileCount, true);
  headerView.setUint16(20, styles.length, true);
  headerView.setUint16(22, NEIGHBORS_PER_TRACK, true);
  headerView.setUint8(24, 1); // file_id_kind = md5_48
  headerView.setUint8(25, 3); // neighbor_ref_width_bytes
  headerView.setUint8(26, 1); // neighbor_ref_kind = absolute_track_ordinal
  headerView.setUint8(27, 2); // style_mask_width_bytes
  headerView.setUint16(28, STYLE_TABLE_VERSION, true);
  headerView.setUint16(30, 0x0007, true); // graph_flags (matches the generator)
  headerView.setUint32(32, styleTableOffset, true);
  headerView.setUint32(36, fileIdentityOffset, true);
  headerView.setUint32(40, fileTrackCountOffset, true);
  headerView.setUint32(44, styleMaskOffset, true);
  headerView.setUint32(48, neighborsOffset, true);
  headerView.setUint32(52, styleTable.length, true);
  headerView.setUint32(56, fileIdentity.length, true);
  headerView.setUint32(60, neighborTable.length, true);

  const sections =
    version >= 2
      ? [header, styleTable, fileIdentity, fileTrackCount, styleMask, ratingTable, neighborTable]
      : [header, styleTable, fileIdentity, fileTrackCount, styleMask, neighborTable];
  const bytes = concatBytes(sections);
  return bytes.buffer.slice(0, bytes.length);
};

/**
 * A compact, valid default fixture: 3 files (4 tracks total), a small acyclic
 * neighbor graph, and known style masks. Good enough for most parser/engine
 * tests that don't need a bespoke topology.
 */
export const buildDefaultTinyFixture = (): ArrayBuffer =>
  buildTinyFixture({
    files: [
      // ordinal 0
      { md5_48: "aaaaaaaaaaaa", tracks: [{ styleMask: 0b000000001, ratings: { e: 8, m: 4, c: 6 } }] },
      // ordinal 1
      {
        md5_48: "bbbbbbbbbbbb",
        tracks: [
          { styleMask: 0b000000101, ratings: { e: 9, m: 3, c: 7 }, neighbors: [{ target: 0, similarity: 0.9 }] },
        ],
      },
      // ordinals 2, 3 (two subsongs of one file)
      {
        md5_48: "cccccccccccc",
        tracks: [
          { styleMask: 0b000000010, ratings: { e: 2, m: 8, c: 3 }, neighbors: [0, 1] },
          { styleMask: 0b000000100, ratings: { e: 5, m: 5, c: 5 }, neighbors: [{ target: 2, similarity: 0.7 }, 0] },
        ],
      },
    ],
  });
