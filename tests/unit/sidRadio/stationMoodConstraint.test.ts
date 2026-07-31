/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A Song station constrained to one mood serves the **intersection** of two conditions, and these
 * tests hold the engine to both of them independently.
 *
 * The expected answers come from {@link admissibleOracle}, which walks the fixture's declared edges
 * and reads the bundle's own style mask. It never calls `computeStation`: an expectation produced by
 * the function under test agrees with that function by construction, including when the function is
 * wrong.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_STATION_BALANCE, computeStation, type StationEngineOptions } from "@/lib/sidRadio/stationEngine";
import {
  CONNECTED_COUNT,
  MOOD,
  MOOD_BITS,
  TRACK_COUNT,
  admissibleOracle,
  buildMoodBundle,
  everyTrackWithMood,
  fullMd5For,
  md548For,
  moodBitsOf,
} from "./moodStationFixture";

const bundle = buildMoodBundle();
const SEED = 0;
const SHUFFLE_SEED = 7;

type StationOverrides = Partial<Omit<StationEngineOptions, "bundle" | "seed">>;

const songStation = (overrides: StationOverrides = {}) =>
  computeStation({
    bundle,
    seed: { kind: "song", md5_48: md548For(SEED) },
    shuffleSeed: SHUFFLE_SEED,
    ...overrides,
  });

const servedBy = (overrides: StationOverrides = {}): number[] =>
  songStation(overrides).candidates.map((candidate) => candidate.trackOrdinal);

/** The set the walk must have found by `minHops`, i.e. what a correct station cannot be missing. */
const mustServe = (styleBit: number | null, extra: Partial<Parameters<typeof admissibleOracle>[0]> = {}) =>
  admissibleOracle({ bundle, seedOrdinals: [SEED], styleBit, hops: DEFAULT_STATION_BALANCE.minHops, ...extra });

/** The set the walk cannot exceed even at `maxHops`, i.e. what a correct station cannot go beyond. */
const mayServe = (styleBit: number | null, extra: Partial<Parameters<typeof admissibleOracle>[0]> = {}) =>
  admissibleOracle({ bundle, seedOrdinals: [SEED], styleBit, hops: DEFAULT_STATION_BALANCE.maxHops, ...extra });

describe("mood-constrained Song station — the fixture itself", () => {
  it("encodes exactly the moods the oracle reads back out of it", () => {
    for (let ordinal = 0; ordinal < TRACK_COUNT; ordinal += 1) {
      const declared = moodBitsOf(ordinal);
      for (const bit of MOOD_BITS) {
        expect((bundle.styleMask[ordinal] & (1 << bit)) !== 0).toBe(declared.includes(bit));
      }
    }
  });

  it("keeps the second component out of the seed's reach, and gives it moods the first one has too", () => {
    const reachable = mayServe(null);
    for (let ordinal = CONNECTED_COUNT; ordinal < TRACK_COUNT; ordinal += 1) {
      expect(reachable.has(ordinal)).toBe(false);
    }
    // 35 is Experimental like 7 and 23; 32–39 are all Deep Cuts. Without that overlap a station
    // could pass these tests by being a mood-only station and nobody would notice.
    expect(everyTrackWithMood(bundle, MOOD.experimental)).toEqual([7, 23, 35]);
    expect(everyTrackWithMood(bundle, MOOD.deepDiscovery)).toEqual([0, 32, 33, 34, 35, 36, 37, 38, 39]);
    expect(everyTrackWithMood(bundle, MOOD.themeHunter)).toEqual([]);
  });
});

describe("mood-constrained Song station — every emitted tune satisfies both conditions", () => {
  it("serves the whole reachable neighbourhood when no mood is selected (All moods)", () => {
    const served = servedBy();
    expect(new Set(served)).toEqual(mayServe(null));
    expect(served).toHaveLength(CONNECTED_COUNT - 1); // everything in the component except the seed
    expect(new Set(served).size).toBe(served.length);
  });

  for (const [name, bit] of Object.entries(MOOD)) {
    it(`serves exactly the tunes that are reachable from the seed AND carry ${name}`, () => {
      const result = songStation({ styleFilter: bit });
      const served = result.candidates.map((candidate) => candidate.trackOrdinal);
      const upperBound = mayServe(bit);

      // Condition 1, read off the bundle: every emitted tune carries the bit.
      for (const ordinal of served) {
        expect(bundle.styleMask[ordinal] & (1 << bit)).not.toBe(0);
      }
      // Condition 2, read off the declared edges: every emitted tune is one the walk could reach,
      // and is not the seed itself.
      for (const ordinal of served) {
        expect(upperBound.has(ordinal)).toBe(true);
        expect(ordinal).not.toBe(SEED);
      }
      // Nothing admissible was dropped, and nothing was served twice.
      for (const ordinal of mustServe(bit)) expect(served).toContain(ordinal);
      expect(new Set(served).size).toBe(served.length);

      if (upperBound.size === 0) {
        expect(served).toHaveLength(0);
        expect(result.empty).toBe("exhausted");
      } else {
        expect(new Set(served)).toEqual(upperBound);
      }
    });
  }

  it("narrows a broad mood to a subset of the unconstrained station rather than re-deriving it", () => {
    const unconstrained = new Set(servedBy());
    const melodic = servedBy({ styleFilter: MOOD.melodic });
    expect(melodic.length).toBeGreaterThan(0);
    expect(melodic.length).toBeLessThan(unconstrained.size);
    for (const ordinal of melodic) expect(unconstrained.has(ordinal)).toBe(true);
  });
});

describe("mood-constrained Song station — the intersection is strict", () => {
  it("never serves a tune that carries the mood but lies outside the seed's similarity graph", () => {
    const served = servedBy({ styleFilter: MOOD.experimental });
    expect(served.slice().sort((a, b) => a - b)).toEqual([7, 23]);
    // 35 carries Experimental and is still refused, because nothing connects it to the seed. An
    // engine that had turned the mood into a score boost, or that filtered a mood station after the
    // fact, would serve it.
    expect(bundle.styleMask[35] & (1 << MOOD.experimental)).not.toBe(0);
    expect(served).not.toContain(35);
  });

  it("never serves a reachable tune that misses the mood", () => {
    const served = servedBy({ styleFilter: MOOD.experimental });
    const reachable = mayServe(null);
    for (const ordinal of reachable) {
      if ((bundle.styleMask[ordinal] & (1 << MOOD.experimental)) === 0) expect(served).not.toContain(ordinal);
    }
  });

  it("widens the walk when the seed's own neighbours miss the mood, instead of stopping at a full hop", () => {
    // `limit` 2 puts the walk's sufficiency test in reach. One hop from the seed already reaches six
    // tunes, which is enough of them by count alone, but only one is Experimental — so the walk has
    // to measure what the MOOD admits, not what it merely reached.
    const widened = songStation({ styleFilter: MOOD.experimental, limit: 2, balance: { minHops: 1 } });
    expect(widened.candidates.map((candidate) => candidate.trackOrdinal).sort((a, b) => a - b)).toEqual([7, 23]);
    expect(widened.empty).toBeUndefined();

    // Held to that one hop it can only find the first of them, which is what a station that stops
    // as soon as the neighbourhood looks full would serve.
    const narrow = songStation({ styleFilter: MOOD.experimental, limit: 2, balance: { minHops: 1, maxHops: 1 } });
    expect(narrow.candidates.map((candidate) => candidate.trackOrdinal)).toEqual([7]);
  });

  it("reports an empty intersection instead of relaxing it to all moods or to the mood alone", () => {
    const result = songStation({ styleFilter: MOOD.deepDiscovery });
    expect(result.candidates).toHaveLength(0);
    expect(result.empty).toBe("exhausted");
    // The mood has eight other members and the seed has a full neighbourhood; a station that fell
    // back to either would have had plenty to serve.
    expect(everyTrackWithMood(bundle, MOOD.deepDiscovery).length).toBeGreaterThan(1);
    expect(servedBy()).not.toHaveLength(0);
  });

  it("keeps a liked tune out unless it carries the mood as well", () => {
    // Ordinal 1 steers the walk as a like seed, and is reachable, but is Chill / Ambient rather than
    // Experimental. Steering must not become a second way in.
    const served = servedBy({ styleFilter: MOOD.experimental, likes: [fullMd5For(1)] });
    expect(served).not.toContain(1);
    for (const ordinal of served) expect(bundle.styleMask[ordinal] & (1 << MOOD.experimental)).not.toBe(0);
  });
});

describe("mood-constrained Song station — composed with the other admission rules", () => {
  it("composes with the minimum-length rule", () => {
    // Stands in for a sound effect: reachable, carries the mood, too short to serve.
    const longEnough = (ordinal: number) => ordinal !== 7;
    const served = servedBy({ styleFilter: MOOD.experimental, admit: longEnough });
    expect(served).toEqual([23]);
    expect(new Set(served)).toEqual(mayServe(MOOD.experimental, { admit: longEnough }));
  });

  it("composes with ✕ (not-for-me)", () => {
    const notForMe = [fullMd5For(7)];
    const served = servedBy({ styleFilter: MOOD.experimental, notForMe });
    expect(served).toEqual([23]);
    expect(new Set(served)).toEqual(mayServe(MOOD.experimental, { notForMe: [7] }));
  });

  it("composes with the already-played exclusion, and keeps serving what is left", () => {
    const played = [3, 6, 9];
    const served = servedBy({ styleFilter: MOOD.melodic, exclude: played });
    for (const ordinal of played) expect(served).not.toContain(ordinal);
    expect(new Set(served)).toEqual(mayServe(MOOD.melodic, { exclude: played }));
    expect(served.length).toBeGreaterThan(0);
  });

  it("composes all three at once and still satisfies both conditions for every emitted tune", () => {
    const played = [3, 6];
    const notForMe = [fullMd5For(9)];
    const admit = (ordinal: number) => ordinal !== 12;
    const served = servedBy({ styleFilter: MOOD.melodic, exclude: played, notForMe, admit });
    expect(served.length).toBeGreaterThan(0);
    for (const ordinal of served) {
      expect(bundle.styleMask[ordinal] & (1 << MOOD.melodic)).not.toBe(0);
      expect(mayServe(null).has(ordinal)).toBe(true);
    }
    expect(new Set(served)).toEqual(mayServe(MOOD.melodic, { exclude: played, notForMe: [9], admit }));
  });
});

describe("mood-constrained Song station — order", () => {
  it("replays a fixed set of inputs identically", () => {
    const first = servedBy({ styleFilter: MOOD.fastPaced });
    const second = servedBy({ styleFilter: MOOD.fastPaced });
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });

  it("gives a different but still valid order for a different shuffleSeed", () => {
    const first = servedBy({ styleFilter: MOOD.fastPaced, shuffleSeed: 11 });
    const second = servedBy({ styleFilter: MOOD.fastPaced, shuffleSeed: 9001 });
    expect(second).not.toEqual(first);
    // Same station, same constraint: a different seed reorders it, it does not widen or narrow it.
    expect(new Set(second)).toEqual(new Set(first));
    for (const ordinal of second) {
      expect(bundle.styleMask[ordinal] & (1 << MOOD.fastPaced)).not.toBe(0);
      expect(mayServe(MOOD.fastPaced).has(ordinal)).toBe(true);
    }
  });
});
