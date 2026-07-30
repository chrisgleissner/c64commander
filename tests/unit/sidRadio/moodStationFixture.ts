/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A synthetic corpus for "one mood over a song seed", and an oracle over it that never asks the
 * station engine what the answer is.
 *
 * The rule under test is a strict conjunction: a tune is served only if it is **reachable in the
 * similarity graph from the seed** AND **carries the selected style bit**. Proving that needs a
 * corpus where the two halves disagree, so the topology here is deliberately split:
 *
 *  - ordinals `0 … CONNECTED_COUNT-1` form one connected component (a circulant graph, so the walk
 *    has somewhere to widen into),
 *  - ordinals `CONNECTED_COUNT … TRACK_COUNT-1` form a second component with **no edge to the
 *    first**, and they carry moods the first component also carries.
 *
 * A station seeded in the first component that ever serves a track from the second has stopped
 * intersecting and started unioning — or has quietly become a mood-only station.
 *
 * Everything below is declared once, and both the bundle bytes and the oracle are derived from the
 * same declaration. The oracle walks the declared edges itself rather than calling `computeStation`,
 * which is the point: a test that asks the production function for its own expected answer passes
 * whatever the function does.
 */

import { parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import { buildTinyFixture } from "../../fixtures/sidcorr/buildTinyFixture";

/** Ordinals below this are the seed's component; the rest are unreachable from it. */
export const CONNECTED_COUNT = 32;
export const TRACK_COUNT = 40;
/** Size of the second, isolated component. */
const ISOLATED_COUNT = TRACK_COUNT - CONNECTED_COUNT;

/**
 * The nine moods, by mask bit — the same bits and order as `SID_RADIO_STYLE_TILES` and as the
 * export's `STYLE_TABLE`, so a test naming a mood names the bit the app would send.
 */
export const MOOD = {
  fastPaced: 0,
  slowAmbient: 1,
  melodic: 2,
  experimental: 3,
  nostalgic: 4,
  composerFocus: 5,
  eraExplorer: 6,
  deepDiscovery: 7,
  themeHunter: 8,
} as const;

export const MOOD_BITS: readonly number[] = Object.values(MOOD);

/**
 * Which moods each track carries.
 *
 * Chosen so the interesting intersections all exist against a seed at ordinal 0:
 *
 *  - **broad** — `fastPaced` / `slowAmbient` split the corpus in half, `melodic` takes a third;
 *  - **sparse** — `experimental` has three members, two reachable (7, 23) and one stranded in the
 *    isolated component (35), so an emitted 35 proves the mood alone decided;
 *  - **empty by intersection** — `deepDiscovery` is carried by the seed itself and by the whole
 *    isolated component, so a station seeded at 0 can admit none of it even though the mood is
 *    well populated;
 *  - **empty by population** — `themeHunter` has no members at all, which is the separate condition
 *    the launcher's population guard refuses ahead of any walk.
 */
export const moodBitsOf = (ordinal: number): number[] => {
  const bits: number[] = [];
  if (ordinal % 2 === 0) bits.push(MOOD.fastPaced);
  else bits.push(MOOD.slowAmbient);
  if (ordinal % 3 === 0) bits.push(MOOD.melodic);
  if (ordinal === 7 || ordinal === 23 || ordinal === 35) bits.push(MOOD.experimental);
  if (ordinal >= 20) bits.push(MOOD.nostalgic);
  if (ordinal % 5 === 0) bits.push(MOOD.composerFocus);
  if (ordinal < 10) bits.push(MOOD.eraExplorer);
  if (ordinal === 0 || ordinal >= CONNECTED_COUNT) bits.push(MOOD.deepDiscovery);
  return bits;
};

/**
 * The declared similarity edges: a circulant graph over the first component, a smaller ring over the
 * isolated one, and nothing between them. Three slots per track is what the export ships.
 */
export const neighborsOf = (ordinal: number): number[] => {
  if (ordinal < CONNECTED_COUNT) {
    return [(ordinal + 1) % CONNECTED_COUNT, (ordinal + 2) % CONNECTED_COUNT, (ordinal + 7) % CONNECTED_COUNT];
  }
  const local = ordinal - CONNECTED_COUNT;
  return [CONNECTED_COUNT + ((local + 1) % ISOLATED_COUNT), CONNECTED_COUNT + ((local + 3) % ISOLATED_COUNT)];
};

/** One track per file, so a track ordinal and a file index are the same number here. */
export const md548For = (ordinal: number): string => ordinal.toString(16).padStart(12, "0");
/** The 32-char MD5 the ranking store keys by; only its first 12 chars address the bundle. */
export const fullMd5For = (ordinal: number): string => md548For(ordinal).padEnd(32, "f");

const maskOf = (ordinal: number): number => moodBitsOf(ordinal).reduce((mask, bit) => mask | (1 << bit), 0);

export const buildMoodBundleBytes = (): ArrayBuffer =>
  buildTinyFixture({
    files: Array.from({ length: TRACK_COUNT }, (_, ordinal) => ({
      md5_48: md548For(ordinal),
      tracks: [{ styleMask: maskOf(ordinal), neighbors: neighborsOf(ordinal) }],
    })),
  });

export const buildMoodBundle = (): SidcorrTinyBundle => parseSidcorrTiny(buildMoodBundleBytes());

/**
 * Undirected adjacency over the declared edges.
 *
 * Undirected because the engine walks forward neighbour edges and the reverse index together, so a
 * one-way oracle would understate what the station can reach and would let a genuinely wrong answer
 * look like a passing one.
 */
const adjacency = (): Map<number, Set<number>> => {
  const graph = new Map<number, Set<number>>();
  const link = (from: number, to: number) => {
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from)!.add(to);
  };
  for (let ordinal = 0; ordinal < TRACK_COUNT; ordinal += 1) {
    for (const target of neighborsOf(ordinal)) {
      link(ordinal, target);
      link(target, ordinal);
    }
  }
  return graph;
};

/** Every ordinal within `hops` edges of `seeds`, seeds included. */
export const reachableWithin = (seeds: readonly number[], hops: number): Set<number> => {
  const graph = adjacency();
  const seen = new Set<number>(seeds);
  let frontier = [...seeds];
  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: number[] = [];
    for (const ordinal of frontier) {
      for (const target of graph.get(ordinal) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return seen;
};

export interface MoodOracleInput {
  bundle: SidcorrTinyBundle;
  /** The ordinals the walk starts from: the song seed, plus any liked tunes that steer it. */
  seedOrdinals: readonly number[];
  /** The mood the station is constrained to, or null for all moods. */
  styleBit: number | null;
  /** How far the walk is allowed to go — pass the balance's `minHops` or `maxHops`. */
  hops: number;
  /** Ordinals already played or queued. */
  exclude?: Iterable<number>;
  /** Ordinals the listener rejected with ✕. */
  notForMe?: Iterable<number>;
  /** The minimum-length rule, or any other extra admission test. */
  admit?: (ordinal: number) => boolean;
}

/**
 * Which tracks a station is allowed to serve, computed from the declared topology and from the
 * bundle's own style mask.
 *
 * Read as the conjunction it is: reachable from the seed, carrying the mood bit, and not removed by
 * any of the admission rules the station composes with. Call it with `hops = minHops` for the set
 * the walk must have found, and with `hops = maxHops` for the set it can never exceed.
 */
export const admissibleOracle = (input: MoodOracleInput): Set<number> => {
  const reachable = reachableWithin(input.seedOrdinals, input.hops);
  const banned = new Set<number>([...input.seedOrdinals, ...(input.exclude ?? []), ...(input.notForMe ?? [])]);
  const mask = input.styleBit === null ? 0 : 1 << input.styleBit;
  const admissible = new Set<number>();
  for (const ordinal of reachable) {
    if (banned.has(ordinal)) continue;
    if (input.styleBit !== null && (input.bundle.styleMask[ordinal] & mask) === 0) continue;
    if (input.admit && !input.admit(ordinal)) continue;
    admissible.add(ordinal);
  }
  return admissible;
};

/** Every ordinal in the corpus carrying a mood, whether or not any station could reach it. */
export const everyTrackWithMood = (bundle: SidcorrTinyBundle, styleBit: number): number[] => {
  const mask = 1 << styleBit;
  const members: number[] = [];
  for (let ordinal = 0; ordinal < TRACK_COUNT; ordinal += 1) {
    if ((bundle.styleMask[ordinal] & mask) !== 0) members.push(ordinal);
  }
  return members;
};
