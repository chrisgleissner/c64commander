/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the `sidflow-data` 0.8.2 corpus migration requires of this consumer.
 *
 * 0.8.0 exported a directed acyclic graph in which every neighbour target was a lower track
 * ordinal. 0.8.2 replaced it with a Vamana (DiskANN) searchable index: every slot carries a real
 * edge, 52% of edges point forward, and cycles are present and intentional. The bundle's other
 * sections are byte-identical, so the migration is entirely about what the edges mean.
 *
 * These tests pin the three things that made the migration safe:
 *
 *   1. `graph_flags` is read and reported, not inferred from silence;
 *   2. the walk terminates on a cyclic graph, because it is hop-bounded rather than
 *      relying on the acyclicity the corpus no longer guarantees;
 *   3. dedupe is the player's job — a cycle must not produce a repeated track.
 */

import { describe, expect, it } from "vitest";

import {
  GRAPH_FLAG_ACYCLIC,
  GRAPH_FLAG_FLOW_SUCCESSOR_FIRST,
  GRAPH_FLAG_RESERVED_LEGACY,
  parseSidcorrTiny,
} from "@/lib/sidRadio/sidcorrTiny";
import { computeStation } from "@/lib/sidRadio/stationEngine";
import { buildReadyStats } from "@/lib/sidRadio/sidRadioWorkerCore";
import { getSidRadioStats, resetSidRadioStats, updateSidRadioStats } from "@/lib/sidRadio/sidRadioStats";
import { SIDCORR_EXPECTED_GRAPH_FLAGS } from "@/lib/sidRadio/sidcorrRelease";
import { buildDefaultTinyFixture, buildTinyFixture, deriveMd548 } from "../../fixtures/sidcorr/buildTinyFixture";

describe("sidcorr graph_flags", () => {
  it("reads the u16 at header offset 30 that the 0.8.2 generator writes", () => {
    const bundle = parseSidcorrTiny(buildDefaultTinyFixture());
    expect(bundle.graphFlags).toBe(SIDCORR_EXPECTED_GRAPH_FLAGS);
    expect(bundle.graphFlags & GRAPH_FLAG_RESERVED_LEGACY).toBe(GRAPH_FLAG_RESERVED_LEGACY);
  });

  it("reports the retired acyclic and flow-successor bits as clear", () => {
    const bundle = parseSidcorrTiny(buildDefaultTinyFixture());
    expect(bundle.graphFlags & GRAPH_FLAG_ACYCLIC).toBe(0);
    expect(bundle.graphFlags & GRAPH_FLAG_FLOW_SUCCESSOR_FIRST).toBe(0);
    // Asserted against a flags value that is actually being read: a parser that returned a
    // constant 0 would satisfy both bit tests above while reporting nothing at all.
    expect(bundle.graphFlags).toBeGreaterThan(0);
  });

  // The format requires consumers to ignore bits they do not recognise. "Ignored" has to mean
  // reported-and-unused rather than never-read, or a future flag day is a silent misparse.
  it("reports unknown flag bits verbatim and parses the bundle unchanged", () => {
    const withUnknownBits = parseSidcorrTiny(buildTinyFixture({ graphFlags: 0xf006, files: [{ tracks: [{}] }] }));
    expect(withUnknownBits.graphFlags).toBe(0xf006);
    expect(withUnknownBits.trackCount).toBe(1);
  });

  // A bundle that declares acyclicity must not be treated differently from one that does not:
  // the app never relies on the property, so the flag changes reporting and nothing else.
  it("parses a bundle that still declares acyclicity, without behaving differently", () => {
    const spec = { files: [{ tracks: [{}] }, { tracks: [{ neighbors: [0] }] }] } as const;
    const legacy = parseSidcorrTiny(buildTinyFixture({ ...spec, graphFlags: 0x0007 }));
    const current = parseSidcorrTiny(buildTinyFixture({ ...spec, graphFlags: 0x0006 }));
    expect(legacy.graphFlags & GRAPH_FLAG_ACYCLIC).toBe(GRAPH_FLAG_ACYCLIC);
    expect(current.graphFlags & GRAPH_FLAG_ACYCLIC).toBe(0);
    expect([...legacy.neighborTargets]).toEqual([...current.neighborTargets]);
    expect(legacy.stats.edgeCount).toBe(current.stats.edgeCount);
  });
});

/**
 * A 6-track corpus of single-subsong files whose slot-0 edges form one 6-cycle
 * (0→1→2→3→4→5→0), plus forward and backward second edges. Under the 0.8.0 rule this bundle
 * could not exist; under 0.8.2 it is the ordinary shape.
 */
const buildCyclicFixture = () =>
  buildTinyFixture({
    files: [0, 1, 2, 3, 4, 5].map((i) => ({
      md5_48: deriveMd548(i),
      tracks: [
        {
          styleMask: 0b000000111,
          neighbors: [
            { target: (i + 1) % 6, similarity: 0.95 },
            { target: (i + 5) % 6, similarity: 0.9 },
          ],
        },
      ],
    })),
  });

describe("computeStation on a cyclic neighbour graph (0.8.2)", () => {
  it("terminates and returns candidates when every edge lies on a cycle", () => {
    const bundle = parseSidcorrTiny(buildCyclicFixture());
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: deriveMd548(0) },
      shuffleSeed: 1,
      limit: 10,
    });
    expect(result.empty).toBeUndefined();
    expect(result.candidates.length).toBeGreaterThan(0);
    // The seed itself is never re-served.
    expect(result.candidates.map((c) => c.trackOrdinal)).not.toContain(0);
  });

  it("never emits a track twice, even though the graph revisits one", () => {
    const bundle = parseSidcorrTiny(buildCyclicFixture());
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: deriveMd548(0) },
      shuffleSeed: 7,
      limit: 10,
    });
    const ordinals = result.candidates.map((c) => c.trackOrdinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
  });

  // The property the re-pin actually rests on. A traversal that assumed acyclicity would either
  // hang or revisit here; the walk is bounded by `maxHops` and a frontier cap instead, so a
  // 6-cycle costs it a bounded number of hops regardless of how deep the cycle runs.
  it("is bounded by maxHops rather than by the graph running out of edges", () => {
    const bundle = parseSidcorrTiny(buildCyclicFixture());
    const shallow = computeStation({
      bundle,
      seed: { kind: "song", md5_48: deriveMd548(0) },
      shuffleSeed: 3,
      limit: 10,
      balance: { minHops: 1, maxHops: 1 },
    });
    const deep = computeStation({
      bundle,
      seed: { kind: "song", md5_48: deriveMd548(0) },
      shuffleSeed: 3,
      limit: 10,
      balance: { minHops: 8, maxHops: 8 },
    });
    // Both terminate. One hop from the seed reaches strictly fewer tracks than eight do, which is
    // only observable because the walk stops on the hop bound rather than on exhausting the graph.
    expect(shallow.candidates.length).toBeGreaterThan(0);
    expect(deep.candidates.length).toBeGreaterThanOrEqual(shallow.candidates.length);
    expect(deep.candidates.length).toBeLessThanOrEqual(5);
  });

  it("excludes what the player has already served, which is what replaces acyclicity", () => {
    const bundle = parseSidcorrTiny(buildCyclicFixture());
    const played = [1, 2, 3];
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: deriveMd548(0) },
      shuffleSeed: 5,
      limit: 10,
      exclude: played,
      recent: played,
    });
    for (const ordinal of played) {
      expect(result.candidates.map((c) => c.trackOrdinal)).not.toContain(ordinal);
    }
  });
});

describe("corpus identity in the ready stats", () => {
  // A run's evidence has to name the corpus that produced it. Reading the flags off the parsed
  // bytes rather than off the pin is what makes a device checkable against the pin without a
  // rebuild — and a device whose shipped asset disagrees with the pin is exactly the case worth
  // being able to see.
  it("carries the graph flags and format version the worker actually parsed", () => {
    const stats = buildReadyStats(buildTinyFixture({ graphFlags: 0x0006, files: [{ tracks: [{}] }] }), false);
    expect(stats.graphFlags).toBe(0x0006);
    expect(stats.version).toBe(2);
  });

  it("reports a corpus whose flags differ from the pinned expectation, rather than normalising it", () => {
    const stats = buildReadyStats(buildTinyFixture({ graphFlags: 0x0007, files: [{ tracks: [{}] }] }), false);
    expect(stats.graphFlags).toBe(0x0007);
    expect(stats.graphFlags).not.toBe(SIDCORR_EXPECTED_GRAPH_FLAGS);
  });
});

describe("buildTinyFixture forward edges", () => {
  // The builder used to reject a forward target outright, which would have made every test above
  // impossible to write. It still rejects an out-of-range one.
  it("accepts a forward edge and rejects an out-of-range target", () => {
    expect(() => buildTinyFixture({ files: [{ tracks: [{ neighbors: [1] }] }, { tracks: [{}] }] })).not.toThrow();
    expect(() => buildTinyFixture({ files: [{ tracks: [{ neighbors: [9] }] }] })).toThrow(/ordinal in \[0, 1\)/);
  });
});

describe("corpus identity survives a station restart", () => {
  // The bundle loads once; a station starts every time the listener picks one, and it resets the
  // counters. Recording the corpus before that reset left the device reporting a corpus it could
  // not name — observed on the Pixel 4 as `corpusGraphFlags: null` on a station that was running.
  it("keeps the parsed format version and graph flags across resetSidRadioStats", () => {
    updateSidRadioStats({ corpusBinaryFormatVersion: 2, corpusGraphFlags: 0x0006, candidatesEmitted: 17 });
    resetSidRadioStats();
    const stats = getSidRadioStats();
    expect(stats.corpusBinaryFormatVersion).toBe(2);
    expect(stats.corpusGraphFlags).toBe(0x0006);
    // The per-station counters are still cleared, which is what the reset is for.
    expect(stats.candidatesEmitted).toBe(0);
  });
});
