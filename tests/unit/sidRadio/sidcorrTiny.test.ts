/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_NEIGHBOR_HOT,
  GRAPH_FLAG_ACYCLIC,
  GRAPH_FLAG_FLOW_SUCCESSOR_FIRST,
  SidcorrParseError,
  parseSidcorrTiny,
} from "@/lib/sidRadio/sidcorrTiny";
import {
  SIDCORR_BUNDLE_PUBLIC_PATH,
  SIDCORR_EXPECTED,
  SIDCORR_EXPECTED_GRAPH_FLAGS,
} from "@/lib/sidRadio/sidcorrRelease";
import { SID_RADIO_STYLE_TILES } from "@/pages/playFiles/hooks/useSidRadio";
import {
  DEFAULT_TINY_STYLES,
  buildDefaultTinyFixture,
  buildTinyFixture,
} from "../../fixtures/sidcorr/buildTinyFixture";

describe("parseSidcorrTiny — header & styles", () => {
  it("decodes the header, counts, and the 9-style table", () => {
    const bundle = parseSidcorrTiny(buildDefaultTinyFixture());
    expect(bundle.version).toBe(2);
    expect(bundle.fileCount).toBe(3);
    expect(bundle.trackCount).toBe(4);
    expect(bundle.styles.map((s) => s.key)).toEqual(DEFAULT_TINY_STYLES.map((s) => s.key));
    expect(bundle.styles.map((s) => s.label)).toEqual(DEFAULT_TINY_STYLES.map((s) => s.label));
    expect(bundle.styles.map((s) => s.maskBit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bundle.styles[0].kind).toBe("audio");
    expect(bundle.styles[5].kind).toBe("hybrid");
  });

  // Spec §5.4: the launcher's labels are UI-side but its keys and mask bits are
  // the export's, and they are what a tile's population is looked up by — a
  // drifted key would silently drop the count and the empty-station guard.
  it("maps the 9 launcher tiles 1:1 onto the parsed STYLE_TABLE", () => {
    const bundle = parseSidcorrTiny(buildDefaultTinyFixture());
    expect(SID_RADIO_STYLE_TILES.map((tile) => tile.key)).toEqual(bundle.styles.map((style) => style.key));
    expect(SID_RADIO_STYLE_TILES.map((tile) => tile.bit)).toEqual(bundle.styles.map((style) => style.maskBit));
  });

  it("rejects a wrong magic", () => {
    const buf = buildDefaultTinyFixture();
    new Uint8Array(buf)[0] = 0x00;
    expect(() => parseSidcorrTiny(buf)).toThrow(SidcorrParseError);
  });

  it("rejects an unsupported binary version", () => {
    const buf = buildDefaultTinyFixture();
    new DataView(buf).setUint16(8, 99, true);
    expect(() => parseSidcorrTiny(buf)).toThrow(/version/i);
  });

  it("rejects a truncated bundle", () => {
    const full = buildDefaultTinyFixture();
    const truncated = full.slice(0, 40);
    expect(() => parseSidcorrTiny(truncated)).toThrow(SidcorrParseError);
  });

  it("rejects a bundle whose section runs past the buffer", () => {
    const buf = buildDefaultTinyFixture();
    new DataView(buf).setUint32(60, 0x7fffffff, true); // neighborsBytes way too big
    expect(() => parseSidcorrTiny(buf)).toThrow(/bounds|truncat/i);
  });
});

describe("parseSidcorrTiny — cold→hot transform", () => {
  const bundle = parseSidcorrTiny(buildDefaultTinyFixture());

  it("expands neighbour targets into an aligned Uint32Array with a hot sentinel", () => {
    expect(bundle.neighborTargets).toBeInstanceOf(Uint32Array);
    expect(bundle.neighborTargets.length).toBe(bundle.trackCount * 3);
    // track 1 → [0, sentinel, sentinel]
    expect(bundle.neighborTargets[1 * 3 + 0]).toBe(0);
    expect(bundle.neighborTargets[1 * 3 + 1]).toBe(EMPTY_NEIGHBOR_HOT);
    // track 3 → [2, 0, sentinel]
    expect(bundle.neighborTargets[3 * 3 + 0]).toBe(2);
    expect(bundle.neighborTargets[3 * 3 + 1]).toBe(0);
    expect(bundle.neighborTargets[3 * 3 + 2]).toBe(EMPTY_NEIGHBOR_HOT);
  });

  it("keeps aligned style-mask and rating arrays", () => {
    expect(bundle.styleMask).toBeInstanceOf(Uint16Array);
    expect(bundle.styleMask[0]).toBe(0b000000001);
    expect(bundle.styleMask[1]).toBe(0b000000101);
    // ratings packed: track 0 e=8,m=4,c=6,p=null
    expect(bundle.ratings[0]).toBe(8 | (4 << 4) | (6 << 8));
  });

  it("builds the reverse CSR (edges pointing INTO a track)", () => {
    // tracks 1, 2, 3 all point at ordinal 0 (via forward edges).
    const sources = bundle.reverseSourcesOf(0);
    expect([...sources].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // ordinal 2 is pointed at by track 3.
    expect([...bundle.reverseSourcesOf(2)]).toEqual([3]);
    // ordinal 3 has no incoming edges.
    expect([...bundle.reverseSourcesOf(3)]).toEqual([]);
  });

  it("resolves a track ordinal to (fileOrdinal, songIndex, md5_48)", () => {
    expect(bundle.resolveTrack(0)).toMatchObject({ fileOrdinal: 0, songIndex: 1, md5_48: "aaaaaaaaaaaa" });
    // ordinals 2 & 3 are the two subsongs of file "cccccccccccc"
    expect(bundle.resolveTrack(2)).toMatchObject({ fileOrdinal: 2, songIndex: 1, md5_48: "cccccccccccc" });
    expect(bundle.resolveTrack(3)).toMatchObject({ fileOrdinal: 2, songIndex: 2, md5_48: "cccccccccccc" });
  });

  it("resolves a seed md5_48 to its file's track ordinals", () => {
    expect(bundle.trackOrdinalsForMd548("cccccccccccc")).toEqual([2, 3]);
    expect(bundle.trackOrdinalsForMd548("aaaaaaaaaaaa")).toEqual([0]);
    expect(bundle.trackOrdinalsForMd548("ffffffffffff")).toEqual([]);
  });

  it("reports a positive memory estimate", () => {
    expect(bundle.stats.memoryEstimateBytes).toBeGreaterThan(0);
    expect(bundle.stats.bundleBytes).toBe(buildDefaultTinyFixture().byteLength);
  });
});

describe("parseSidcorrTiny — v1 compatibility", () => {
  it("parses a v1 bundle (no rating table, similarity defaults)", () => {
    const bundle = parseSidcorrTiny(
      buildTinyFixture({ version: 1, files: [{ tracks: [{ styleMask: 1 }] }, { tracks: [{ neighbors: [0] }] }] }),
    );
    expect(bundle.version).toBe(1);
    expect(bundle.trackCount).toBe(2);
    expect(bundle.neighborTargets[1 * 3 + 0]).toBe(0);
    expect([...bundle.reverseSourcesOf(0)]).toEqual([1]);
  });
});

// Opt-in golden: parses the REAL pinned bundle and checks it against the manifest
// (spec §7 M0 golden smoke test). Run with `SIDCORR_REAL=1 npx vitest run ...`.
const realBundlePath = path.resolve(process.cwd(), "public", SIDCORR_BUNDLE_PUBLIC_PATH);
describe.skipIf(!process.env.SIDCORR_REAL)("parseSidcorrTiny — real bundle golden", () => {
  it("round-trips the pinned bundle and matches the manifest counts", () => {
    const data = readFileSync(realBundlePath);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const bundle = parseSidcorrTiny(buffer);
    expect(bundle.version).toBe(2);
    expect(bundle.fileCount).toBe(SIDCORR_EXPECTED.fileCount);
    expect(bundle.trackCount).toBe(SIDCORR_EXPECTED.trackCount);
    expect(bundle.styles).toHaveLength(SIDCORR_EXPECTED.styleCount);
    expect(bundle.styles.map((s) => s.key)).toEqual([
      "fast_paced",
      "slow_ambient",
      "melodic",
      "experimental",
      "nostalgic",
      "composer_focus",
      "era_explorer",
      "deep_discovery",
      "theme_hunter",
    ]);
    // Reverse CSR must account for every forward edge.
    expect(bundle.reverseSource.length).toBe(bundle.stats.edgeCount);
    expect(bundle.stats.edgeCount).toBeGreaterThan(0);
    expect(bundle.trackOrdinalsForMd548(bundle.resolveTrack(1000).md5_48).length).toBeGreaterThan(0);
  });

  // The 0.8.2 neighbour graph is a Vamana (DiskANN) index, not the DAG 0.8.0 shipped. These are
  // the properties the station depends on, checked against the shipped bytes rather than against
  // the manifest's description of them. They mirror sidflow's own `verify-published-exports.ts`.
  it("carries the 0.8.2 graph flags: neither acyclic nor a flow successor", () => {
    const data = readFileSync(realBundlePath);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const bundle = parseSidcorrTiny(buffer);
    expect(bundle.graphFlags).toBe(SIDCORR_EXPECTED_GRAPH_FLAGS);
    expect(bundle.graphFlags & GRAPH_FLAG_ACYCLIC).toBe(0);
    expect(bundle.graphFlags & GRAPH_FLAG_FLOW_SUCCESSOR_FIRST).toBe(0);
  });

  it("fills every neighbour slot, with no dead end and no self edge", () => {
    const data = readFileSync(realBundlePath);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const bundle = parseSidcorrTiny(buffer);
    const slots = bundle.trackCount * SIDCORR_EXPECTED.neighborsPerTrack;
    // 0.8.0 shipped 17,640 sentinels (6.69% of slot capacity); 0.8.2 ships none.
    expect(bundle.stats.edgeCount).toBe(slots);
    let selfEdges = 0;
    let deadEnds = 0;
    for (let track = 0; track < bundle.trackCount; track += 1) {
      let outDegree = 0;
      for (let slot = 0; slot < SIDCORR_EXPECTED.neighborsPerTrack; slot += 1) {
        const target = bundle.neighborTargets[track * SIDCORR_EXPECTED.neighborsPerTrack + slot];
        if (target === EMPTY_NEIGHBOR_HOT) continue;
        outDegree += 1;
        if (target === track) selfEdges += 1;
      }
      if (outDegree === 0) deadEnds += 1;
    }
    expect(selfEdges).toBe(0);
    expect(deadEnds).toBe(0);
  });

  // The retired rule, asserted absent. 0.8.0 pointed 100% of edges at a lower ordinal; if a
  // bundle ever went back to that shape it would be a silent 74% loss of station depth on the
  // fixed-seed path, so the forward edges are worth pinning rather than assuming.
  it("no longer restricts neighbour targets to lower ordinals", () => {
    const data = readFileSync(realBundlePath);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const bundle = parseSidcorrTiny(buffer);
    let forward = 0;
    for (let track = 0; track < bundle.trackCount; track += 1) {
      for (let slot = 0; slot < SIDCORR_EXPECTED.neighborsPerTrack; slot += 1) {
        const target = bundle.neighborTargets[track * SIDCORR_EXPECTED.neighborsPerTrack + slot];
        if (target !== EMPTY_NEIGHBOR_HOT && target > track) forward += 1;
      }
    }
    // Measured on 0.8.2: 137,130 of 263,604 edges (52.0%) point forward.
    expect(forward / bundle.stats.edgeCount).toBeGreaterThan(0.4);
  });

  it("keeps every track reachable and the corpus in one navigable region", () => {
    const data = readFileSync(realBundlePath);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const bundle = parseSidcorrTiny(buffer);
    const inDegree = new Int32Array(bundle.trackCount);
    for (const target of bundle.neighborTargets) {
      if (target !== EMPTY_NEIGHBOR_HOT) inDegree[target] += 1;
    }
    let unreachable = 0;
    let inDegreeMax = 0;
    for (const degree of inDegree) {
      if (degree === 0) unreachable += 1;
      if (degree > inDegreeMax) inDegreeMax = degree;
    }
    // 0.8.0 left 24,669 tracks (28.08%) with no incoming edge; 0.8.2 leaves 2 (0.002%).
    expect(unreachable).toBeLessThanOrEqual(Math.floor(bundle.trackCount / 1000));
    // No track may become everyone's neighbour — a hub is the same handful of tunes in every
    // station. The bound is 64x the mean, which is the bound sidflow's own release check applies.
    const meanOutDegree = bundle.stats.edgeCount / bundle.trackCount;
    expect(inDegreeMax).toBeLessThanOrEqual(meanOutDegree * 64);
  });

  // Every style tile must have a population, or its launcher tile is a station that cannot start.
  it("ships all nine style masks with a non-empty population", () => {
    const data = readFileSync(realBundlePath);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const bundle = parseSidcorrTiny(buffer);
    const populations = new Array(SIDCORR_EXPECTED.styleCount).fill(0);
    for (let track = 0; track < bundle.trackCount; track += 1) {
      for (let bit = 0; bit < SIDCORR_EXPECTED.styleCount; bit += 1) {
        if (bundle.styleMask[track] & (1 << bit)) populations[bit] += 1;
      }
    }
    // 0.8.2 leaves the style masks byte-identical to 0.8.0: all nine at 17,574 (20% each).
    expect(populations).toEqual(new Array(SIDCORR_EXPECTED.styleCount).fill(17574));
  });
});
