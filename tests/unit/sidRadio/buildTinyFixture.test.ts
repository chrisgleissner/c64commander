/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TINY_STYLES,
  SIDTINY_EMPTY_NEIGHBOR,
  buildDefaultTinyFixture,
  buildTinyFixture,
} from "../../fixtures/sidcorr/buildTinyFixture";

/** Minimal raw header reader — deliberately independent of the production parser. */
const readHeader = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 8));
  return {
    magic,
    version: view.getUint16(8, true),
    headerBytes: view.getUint16(10, true),
    trackCount: view.getUint32(12, true),
    fileCount: view.getUint32(16, true),
    styleCount: view.getUint16(20, true),
    neighborsPerTrack: view.getUint16(22, true),
    styleMaskWidth: view.getUint8(27),
    graphFlags: view.getUint16(30, true),
    styleTableOffset: view.getUint32(32, true),
    fileIdentityOffset: view.getUint32(36, true),
    fileTrackCountOffset: view.getUint32(40, true),
    styleMaskOffset: view.getUint32(44, true),
    neighborsOffset: view.getUint32(48, true),
    styleTableBytes: view.getUint32(52, true),
    fileIdentityBytes: view.getUint32(56, true),
    neighborsBytes: view.getUint32(60, true),
  };
};

const readStyleKeys = (buffer: ArrayBuffer, h: ReturnType<typeof readHeader>) => {
  const view = new DataView(buffer);
  const recordBytes = view.getUint16(h.styleTableOffset + 4, true);
  const recordStart = h.styleTableOffset + 12;
  const payloadStart = recordStart + recordBytes * h.styleCount;
  const decoder = new TextDecoder();
  const keys: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < h.styleCount; i += 1) {
    const rs = recordStart + i * recordBytes;
    const keyOff = view.getUint32(rs + 8, true);
    const keyLen = view.getUint16(rs + 12, true);
    const labOff = view.getUint32(rs + 14, true);
    const labLen = view.getUint16(rs + 18, true);
    keys.push(decoder.decode(new Uint8Array(buffer, payloadStart + keyOff, keyLen)));
    labels.push(decoder.decode(new Uint8Array(buffer, payloadStart + labOff, labLen)));
  }
  return { keys, labels };
};

describe("buildTinyFixture (v2)", () => {
  const buffer = buildDefaultTinyFixture();
  const h = readHeader(buffer);

  it("writes a valid SIDTINY1 v2 header with the expected counts", () => {
    expect(h.magic).toBe("SIDTINY1");
    expect(h.version).toBe(2);
    expect(h.headerBytes).toBe(64);
    expect(h.fileCount).toBe(3);
    expect(h.trackCount).toBe(4);
    expect(h.styleCount).toBe(9);
    expect(h.neighborsPerTrack).toBe(3);
    expect(h.styleMaskWidth).toBe(2);
    // 0x0006 from sidflow-data 0.8.2 onward: the two legacy reserved bits, with bit 0 (acyclic)
    // cleared because the export is now a Vamana index with cycles. 0.8.0 wrote 0x0007.
    expect(h.graphFlags).toBe(0x0006);
  });

  it("lays out sections contiguously with the real v2 sizes", () => {
    expect(h.styleTableOffset).toBe(64);
    expect(h.fileIdentityOffset).toBe(64 + h.styleTableBytes);
    expect(h.fileIdentityBytes).toBe(h.fileCount * 6);
    expect(h.fileTrackCountOffset).toBe(h.fileIdentityOffset + h.fileIdentityBytes);
    expect(h.styleMaskOffset).toBe(h.fileTrackCountOffset + h.fileCount);
    // v2 inserts a rating table (track_count * 2) before the neighbor table.
    expect(h.neighborsOffset).toBe(h.styleMaskOffset + h.trackCount * 2 + h.trackCount * 2);
    // v2 neighbor record = u24 target + u8 similarity.
    expect(h.neighborsBytes).toBe(h.trackCount * 3 * 4);
    // Whole file is exactly the sections, tightly packed.
    expect(buffer.byteLength).toBe(h.neighborsOffset + h.neighborsBytes);
  });

  it("emits the 9 canonical styles in mask-bit order", () => {
    const { keys, labels } = readStyleKeys(buffer, h);
    expect(keys).toEqual(DEFAULT_TINY_STYLES.map((s) => s.key));
    expect(labels).toEqual(DEFAULT_TINY_STYLES.map((s) => s.label));
  });

  it("stores fileTrackCountMinus1 that sums back to track_count", () => {
    const bytes = new Uint8Array(buffer, h.fileTrackCountOffset, h.fileCount);
    const sum = [...bytes].reduce((acc, v) => acc + v + 1, 0);
    expect(sum).toBe(h.trackCount);
    // File "cccccccccccc" holds 2 subsongs → stored value 1.
    expect(bytes[2]).toBe(1);
  });

  it("stores the raw 6-byte md5_48 prefixes", () => {
    const first = [...new Uint8Array(buffer, h.fileIdentityOffset, 6)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(first).toBe("aaaaaaaaaaaa");
  });

  it("round-trips style masks and packed ratings", () => {
    const view = new DataView(buffer);
    expect(view.getUint16(h.styleMaskOffset + 0 * 2, true)).toBe(0b000000001);
    expect(view.getUint16(h.styleMaskOffset + 1 * 2, true)).toBe(0b000000101);
    const ratingOffset = h.styleMaskOffset + h.trackCount * 2;
    // track 0 ratings e=8,m=4,c=6,p=null → 8 | 4<<4 | 6<<8 | 0<<12
    expect(view.getUint16(ratingOffset + 0 * 2, true)).toBe(8 | (4 << 4) | (6 << 8));
  });

  it("writes backward-only neighbor edges with a similarity byte and sentinel padding", () => {
    const view = new DataView(buffer);
    const readU24 = (off: number) =>
      view.getUint8(off) | (view.getUint8(off + 1) << 8) | (view.getUint8(off + 2) << 16);
    const rec = (ordinal: number, slot: number) => h.neighborsOffset + (ordinal * 3 + slot) * 4;
    // track 1 → [0, sentinel, sentinel]
    expect(readU24(rec(1, 0))).toBe(0);
    expect(readU24(rec(1, 1))).toBe(SIDTINY_EMPTY_NEIGHBOR);
    // track 3 → [2, 0, sentinel]; similarity byte present for populated slots
    expect(readU24(rec(3, 0))).toBe(2);
    expect(readU24(rec(3, 1))).toBe(0);
    expect(readU24(rec(3, 2))).toBe(SIDTINY_EMPTY_NEIGHBOR);
    expect(view.getUint8(rec(1, 0) + 3)).toBeGreaterThan(0); // similarity 0.9 → high byte
  });

  // This test used to assert the opposite: that a forward edge was rejected, because through
  // sidflow-data 0.8.0 every exported target was a lower track ordinal and the fixture enforced
  // it. 0.8.2 replaced the DAG with a Vamana index in which 52% of edges point forward, so a
  // builder that still rejected them could not produce a bundle shaped like the one the app
  // parses. Out-of-range targets are still rejected — that is a real encoding error, not a
  // retired convention.
  it("accepts a forward neighbor edge and rejects an out-of-range one", () => {
    expect(() =>
      buildTinyFixture({
        files: [{ tracks: [{ neighbors: [1] }, {}] }], // track 0 points forward to 1
      }),
    ).not.toThrow();
    expect(() =>
      buildTinyFixture({
        files: [{ tracks: [{ neighbors: [2] }, {}] }], // only ordinals 0 and 1 exist
      }),
    ).toThrow(/ordinal in \[0, 2\)/);
  });
});

describe("buildTinyFixture (v1)", () => {
  const buffer = buildTinyFixture({
    version: 1,
    files: [{ tracks: [{ styleMask: 1 }] }, { tracks: [{ neighbors: [0] }] }],
  });
  const h = readHeader(buffer);

  it("omits the rating table and uses 3-byte neighbor rows", () => {
    expect(h.version).toBe(1);
    expect(h.neighborsBytes).toBe(h.trackCount * 3 * 3);
    // No rating table in v1: neighbors follow the style mask directly.
    expect(h.neighborsOffset).toBe(h.styleMaskOffset + h.trackCount * 2);
    expect(buffer.byteLength).toBe(h.neighborsOffset + h.neighborsBytes);
  });
});
