/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How ♥ and ✕ shape a station, for every seed kind (E3).
 *
 * The engine already hard-excluded a rejected tune and had a Not-for-me neighbourhood penalty, but
 * nothing asserted the penalty did anything, and it was a flat subtraction against seed mass that
 * differs by more than an order of magnitude between a Song station (one seed) and a Style station
 * (32 sampled seeds) — so it moved a Song candidate a long way and a Style candidate barely at all.
 * These tests pin the down-weight as an exact ratio, which only a scale-free rule can satisfy.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_STATION_BALANCE, computeStation } from "@/lib/sidRadio/stationEngine";
import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

const md5At = (index: number): string => `${index}`.padStart(12, "a");
const full = (md5_48: string): string => md5_48 + "0".repeat(32 - md5_48.length);

/** A 10-link chain, every track in style 0, so a Song and a Style station see the same graph. */
const chainBundle = (): SidcorrTinyBundle =>
  parseSidcorrTiny(
    buildTinyFixture({
      files: Array.from({ length: 10 }, (_, index) => ({
        md5_48: md5At(index),
        tracks: [{ styleMask: 0b1, neighbors: index === 0 ? [] : [index - 1, Math.max(0, index - 2)] }],
      })),
    }),
  );

const scoreOf = (result: ReturnType<typeof computeStation>, ordinal: number): number | undefined =>
  result.candidates.find((candidate) => candidate.trackOrdinal === ordinal)?.score;

describe("a rejected tune is never served again, and its neighbourhood is only down-weighted", () => {
  const bundle = chainBundle();

  it("hard-excludes the rejected tune and every subsong of its file, on a Song station", () => {
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: md5At(5) },
      notForMe: [full(md5At(6))],
      shuffleSeed: 3,
    });
    expect(result.candidates.map((candidate) => candidate.trackOrdinal)).not.toContain(6);
  });

  it("keeps exactly `rejectNeighbourhoodScale` of a neighbour's score on a Song station", () => {
    const seed = { kind: "song" as const, md5_48: md5At(5) };
    const before = computeStation({ bundle, seed, shuffleSeed: 3 });
    const after = computeStation({ bundle, seed, notForMe: [full(md5At(6))], shuffleSeed: 3 });
    // 7 is a neighbour of the rejected 6, so it is down-weighted; 4 is not adjacent to 6 at all.
    expect(scoreOf(after, 7)).toBeCloseTo(scoreOf(before, 7)! * DEFAULT_STATION_BALANCE.rejectNeighbourhoodScale, 10);
  });

  it("keeps the same fraction on a Style station, whose seed mass is 32 times larger", () => {
    // The old flat penalty was ~2.5 against a Song candidate scoring ~3 and a Style candidate scoring
    // ~90: the same rule, two completely different strengths. A ratio is the same rule everywhere.
    const seed = { kind: "style" as const, styleBit: 0 };
    const before = computeStation({ bundle, seed, styleFilter: 0, shuffleSeed: 3 });
    const after = computeStation({ bundle, seed, styleFilter: 0, notForMe: [full(md5At(6))], shuffleSeed: 3 });
    expect(scoreOf(after, 7)).toBeCloseTo(scoreOf(before, 7)! * DEFAULT_STATION_BALANCE.rejectNeighbourhoodScale, 10);
  });

  it("down-weights rather than bans, so a rejected tune's neighbours stay playable", () => {
    const result = computeStation({
      bundle,
      seed: { kind: "song", md5_48: md5At(5) },
      notForMe: [full(md5At(6))],
      shuffleSeed: 3,
    });
    expect(result.candidates.map((candidate) => candidate.trackOrdinal)).toContain(7);
  });

  it("still applies the down-weight once the query has drifted away from the seed", () => {
    const seed = { kind: "song" as const, md5_48: md5At(2) };
    const recent = [8, 7];
    const before = computeStation({ bundle, seed, recent, exclude: recent, shuffleSeed: 3 });
    const after = computeStation({
      bundle,
      seed,
      recent,
      exclude: recent,
      notForMe: [full(md5At(6))],
      shuffleSeed: 3,
    });
    expect(scoreOf(after, 5)).toBeCloseTo(scoreOf(before, 5)! * DEFAULT_STATION_BALANCE.rejectNeighbourhoodScale, 10);
  });
});

describe("likes steer a station without collapsing it onto the likes", () => {
  /**
   * Twenty isolated pairs — liking the odd track of each pair puts score on exactly its even
   * neighbour. Counting how many even ordinals appear therefore counts how many likes are steering.
   */
  const pairsBundle = (): SidcorrTinyBundle =>
    parseSidcorrTiny(
      buildTinyFixture({
        files: [
          ...Array.from({ length: 40 }, (_, ordinal) => ({
            md5_48: md5At(ordinal),
            tracks: [{ styleMask: 0b1, neighbors: ordinal % 2 === 1 ? [ordinal - 1] : [] }],
          })),
          { md5_48: md5At(40), tracks: [{ styleMask: 0b1, neighbors: [] }] },
          { md5_48: md5At(41), tracks: [{ styleMask: 0b1, neighbors: [40] }] },
        ],
      }),
    );
  const bundle = pairsBundle();
  const likes = Array.from({ length: 20 }, (_, index) => full(md5At(index * 2 + 1)));
  const seed = { kind: "song" as const, md5_48: md5At(41) };
  const likedNeighboursIn = (result: ReturnType<typeof computeStation>): number =>
    result.candidates.filter((candidate) => candidate.trackOrdinal < 40 && candidate.trackOrdinal % 2 === 0).length;

  it("steers from a bounded diversity sample of the likes, not from all of them", () => {
    const result = computeStation({ bundle, seed, likes, shuffleSeed: 11 });
    expect(likedNeighboursIn(result)).toBe(DEFAULT_STATION_BALANCE.likeSteerSample);
  });

  it("keeps the thing the listener asked for reachable alongside the likes", () => {
    const result = computeStation({ bundle, seed, likes, shuffleSeed: 11 });
    expect(result.candidates.map((candidate) => candidate.trackOrdinal)).toContain(40);
  });

  it("widens the steer when the sample size is raised", () => {
    const result = computeStation({ bundle, seed, likes, shuffleSeed: 11, balance: { likeSteerSample: 20 } });
    expect(likedNeighboursIn(result)).toBe(20);
  });

  it("samples deterministically per shuffleSeed and differently across seeds", () => {
    const ordinalsFor = (shuffleSeed: number) =>
      computeStation({ bundle, seed, likes, shuffleSeed })
        .candidates.filter((candidate) => candidate.trackOrdinal < 40 && candidate.trackOrdinal % 2 === 0)
        .map((candidate) => candidate.trackOrdinal)
        .sort((a, b) => a - b);
    expect(ordinalsFor(11)).toEqual(ordinalsFor(11));
    expect(ordinalsFor(11)).not.toEqual(ordinalsFor(987654));
  });
});

describe("the shipped balance keeps taste audible as the query drifts", () => {
  /**
   * The drifting query adds a seed per recently played track. If that history outweighed the taste
   * signal, ♥ and ✕ would stop mattering a few tracks into every station — the failure mode E1 could
   * have introduced. So the two pulls are compared here, deliberately, rather than left to whatever
   * the constants happen to be.
   */
  const totalRecentPull = (): number => {
    let pull = 0;
    let weight = DEFAULT_STATION_BALANCE.recentWeight;
    for (let index = 0; index < DEFAULT_STATION_BALANCE.recentWindow; index += 1) {
      pull += weight;
      weight *= DEFAULT_STATION_BALANCE.recencyDecay;
    }
    return pull;
  };

  it("gives the likes at least as much total seed weight as the recent window", () => {
    const tastePull = DEFAULT_STATION_BALANCE.likeSteerSample * DEFAULT_STATION_BALANCE.likeSteerWeight;
    expect(tastePull).toBeGreaterThanOrEqual(totalRecentPull());
  });

  it("gives one recently played track more pull than the origin, so the station moves", () => {
    expect(DEFAULT_STATION_BALANCE.recentWeight).toBeGreaterThan(DEFAULT_STATION_BALANCE.originWeight);
  });

  it("keeps the origin pulling, so a station still resembles what was asked for", () => {
    expect(DEFAULT_STATION_BALANCE.originWeight).toBeGreaterThan(0);
  });
});
