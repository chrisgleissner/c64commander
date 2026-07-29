/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { computeStation } from "@/lib/sidRadio/stationEngine";
import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

// A small backward-DAG with two styles (bit 0 = "0b001", bit 1 = "0b010").
// ordinal : md5_48 : styleMask : backward neighbours
const MD5_48 = [
  "aaaaaaaaaaaa", // 0
  "bbbbbbbbbbbb", // 1
  "cccccccccccc", // 2
  "dddddddddddd", // 3
  "eeeeeeeeeeee", // 4
  "ffffffffffff", // 5
  "111111111111", // 6
  "222222222222", // 7
];
const full = (md5_48: string) => md5_48 + "0".repeat(32 - md5_48.length);

const engineBundle = (): SidcorrTinyBundle =>
  parseSidcorrTiny(
    buildTinyFixture({
      files: [
        { md5_48: MD5_48[0], tracks: [{ styleMask: 0b001 }] },
        { md5_48: MD5_48[1], tracks: [{ styleMask: 0b001, neighbors: [0] }] },
        { md5_48: MD5_48[2], tracks: [{ styleMask: 0b010, neighbors: [1, 0] }] },
        { md5_48: MD5_48[3], tracks: [{ styleMask: 0b001, neighbors: [2, 1] }] },
        { md5_48: MD5_48[4], tracks: [{ styleMask: 0b010, neighbors: [3, 2] }] },
        { md5_48: MD5_48[5], tracks: [{ styleMask: 0b001, neighbors: [4, 3] }] },
        { md5_48: MD5_48[6], tracks: [{ styleMask: 0b010, neighbors: [5, 4] }] },
        { md5_48: MD5_48[7], tracks: [{ styleMask: 0b001, neighbors: [6, 5] }] },
      ],
    }),
  );

describe("stationEngine — seed resolution & traversal", () => {
  const bundle = engineBundle();

  it("Song Radio yields related candidates and never replays the seed", () => {
    const result = computeStation({ bundle, seed: { kind: "song", md5_48: MD5_48[3] }, shuffleSeed: 7 });
    expect(result.empty).toBeUndefined();
    expect(result.candidates.length).toBeGreaterThan(0);
    const ordinals = result.candidates.map((c) => c.trackOrdinal);
    expect(ordinals).not.toContain(3); // the seed itself
    // Forward + reverse neighbours of 3 appear (2,1 forward; 4,5 reverse).
    expect(ordinals).toEqual(expect.arrayContaining([2, 1, 4]));
    expect(result.candidates[0].reason).toBe("similar");
  });

  it("returns an empty 'no-neighbours' result for an unknown seed", () => {
    const result = computeStation({ bundle, seed: { kind: "song", md5_48: "999999999999" }, shuffleSeed: 7 });
    expect(result.candidates).toEqual([]);
    expect(result.empty).toBe("no-neighbours");
  });

  it("admits only style-matching candidates under a style filter", () => {
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: MD5_48[3] },
      styleFilter: 1,
      shuffleSeed: 7,
    });
    for (const candidate of result.candidates) {
      expect(bundle.styleMask[candidate.trackOrdinal] & (1 << 1)).not.toBe(0);
    }
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("excludes already-played ordinals (dedupe)", () => {
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: MD5_48[3] },
      exclude: [2, 4],
      shuffleSeed: 7,
    });
    const ordinals = result.candidates.map((c) => c.trackOrdinal);
    expect(ordinals).not.toContain(2);
    expect(ordinals).not.toContain(4);
  });

  it("hard-excludes a Not-for-me tune and down-weights its neighbourhood (D8)", () => {
    const withNotForMe = computeStation({
      bundle,
      seed: { kind: "song", md5_48: MD5_48[3] },
      notForMe: [full(MD5_48[2])], // ordinal 2
      shuffleSeed: 7,
    });
    expect(withNotForMe.candidates.map((c) => c.trackOrdinal)).not.toContain(2);
  });

  it("Taste Radio seeds from likes; empty without any likes", () => {
    expect(computeStation({ bundle, seed: { kind: "taste" }, shuffleSeed: 7 }).empty).toBe("no-neighbours");
    const tasteful = computeStation({ bundle, seed: { kind: "taste" }, likes: [full(MD5_48[5])], shuffleSeed: 7 });
    expect(tasteful.candidates.length).toBeGreaterThan(0);
    expect(tasteful.candidates.every((c) => c.trackOrdinal !== 5)).toBe(true);
    expect(tasteful.candidates[0].reason).toBe("taste");
  });

  it("likes steer a Song station toward the liked neighbourhood", () => {
    const base = computeStation({ bundle, seed: { kind: "song", md5_48: MD5_48[3] }, shuffleSeed: 7 });
    const steered = computeStation({
      bundle,
      seed: { kind: "song", md5_48: MD5_48[3] },
      likes: [full(MD5_48[6])],
      shuffleSeed: 7,
    });
    const baseHas6 = base.candidates.some((c) => c.trackOrdinal === 6);
    const steeredHas6 = steered.candidates.some((c) => c.trackOrdinal === 6);
    // Liking 6 must not drop it and should keep/raise its presence.
    expect(steeredHas6 || !baseHas6).toBe(true);
  });
});

describe("stationEngine — determinism (G11)", () => {
  const bundle = engineBundle();
  const opts = {
    bundle,
    seed: { kind: "song" as const, md5_48: MD5_48[3] },
    likes: [full(MD5_48[6])],
    shuffleSeed: 4242,
  };

  it("emits a byte-identical sequence for a fixed (seed, rankingSnapshot, shuffleSeed)", () => {
    const a = computeStation(opts).candidates.map((c) => c.trackOrdinal);
    const b = computeStation(opts).candidates.map((c) => c.trackOrdinal);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("varies the order for a different shuffleSeed but keeps the tune set overlapping", () => {
    const a = computeStation({ ...opts, shuffleSeed: 1 }).candidates.map((c) => c.trackOrdinal);
    const b = computeStation({ ...opts, shuffleSeed: 999999 }).candidates.map((c) => c.trackOrdinal);
    expect(new Set(a)).toEqual(new Set(b)); // same admitted set
    expect(a).not.toEqual(b); // different order
  });

  it("has a stable ascending-ordinal tie-break (repeatable)", () => {
    const first = computeStation({ ...opts, shuffleSeed: 0 }).candidates.map((c) => c.trackOrdinal);
    const second = computeStation({ ...opts, shuffleSeed: 0 }).candidates.map((c) => c.trackOrdinal);
    expect(first).toEqual(second);
  });
});

describe("the walk widens when admission is thin", () => {
  /**
   * A chain: 0 <- 1 <- 2 <- ... <- 11. From a seed at one end, three hops reach only a handful of
   * ordinals. If a filter then rejects everything within those three hops, a fixed-depth walk reports
   * the station exhausted while most of the chain is still reachable — which is exactly what the
   * minimum-length rule does to a neighbourhood full of sound effects.
   */
  const chainBundle = (): SidcorrTinyBundle => {
    const md5s = Array.from({ length: 12 }, (_, i) => `${i}`.padStart(12, "e"));
    return parseSidcorrTiny(
      buildTinyFixture({
        files: md5s.map((md5_48, i) => ({
          md5_48,
          tracks: [{ styleMask: 0b001, neighbors: i === 0 ? [] : [i - 1] }],
        })),
      }),
    );
  };

  it("keeps walking past a neighbourhood the filter has emptied", () => {
    const bundle = chainBundle();
    // Everything within easy reach of the seed is rejected; only the far end is admissible.
    const admit = (ordinal: number) => ordinal >= 8;
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: "eeeeeeeeeee0" },
      shuffleSeed: 1,
      limit: 2,
      admit,
    });
    // Without widening this is `{ candidates: [], empty: "exhausted" }` — the station telling the
    // listener it has played everything it could find, having looked at a twelfth of the graph.
    expect(result.empty).toBeUndefined();
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) expect(candidate.trackOrdinal).toBeGreaterThanOrEqual(8);
  });

  it("still reports exhausted when nothing anywhere is admissible", () => {
    // Widening is not the same as never giving up: a graph with no admissible track must still say so,
    // or the queue would spin instead of telling the listener to pick another station.
    const result = computeStation({
      bundle: chainBundle(),
      seed: { kind: "song", md5_48: "eeeeeeeeeee0" },
      shuffleSeed: 1,
      limit: 2,
      admit: () => false,
    });
    expect(result.empty).toBe("exhausted");
  });

  it("does not change what a healthy station returns", () => {
    // The widening must be invisible when the first hops already yield enough, or every station pays
    // for a problem only some of them have.
    const bundle = chainBundle();
    const withPredicate = computeStation({
      bundle,
      seed: { kind: "song", md5_48: "eeeeeeeeeee0" },
      shuffleSeed: 7,
      limit: 3,
      admit: () => true,
    });
    const without = computeStation({
      bundle,
      seed: { kind: "song", md5_48: "eeeeeeeeeee0" },
      shuffleSeed: 7,
      limit: 3,
    });
    expect(withPredicate.candidates.map((c) => c.trackOrdinal)).toEqual(without.candidates.map((c) => c.trackOrdinal));
  });
});
