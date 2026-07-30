/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The station engine (spec §2.3) — a **pure, deterministic** function of
 * `(seed, recent, rankingSnapshot, shuffleSeed)` that turns the similarity graph
 * into an ordered candidate stream. It runs off the main thread (in
 * `sidRadio.worker.ts`).
 *
 * Traversal: seeds → BFS over forward + reverse neighbour edges (the reverse CSR
 * built once at load, §2.3 step 1) → rank-weighted, hop-decayed scoring
 * (`Σ seedWeight × (neighbors − rank)`, §2.3 step 4). Likes add steer-seeds;
 * Not-for-me hard-excludes the tune and down-weights its neighbourhood
 * (future-refill only, D8). An optional style-mask filter admits candidates
 * (Style Radio / Style × Likes composition, D10).
 *
 * The query **drifts**: the tracks the listener just heard are seeds too, at a
 * recency-decayed weight, so the retrieval centre moves with the listener
 * instead of staying a fixed sphere around the tile they tapped. See
 * {@link StationBalance} for what aims a station and what lets it roam.
 *
 * Determinism (G11): scoring is integer-rank based (D16 — the per-edge
 * similarity byte is intentionally unused). The only randomness is the explicit
 * `shuffleSeed`, applied as a deterministic **weighted permutation**
 * (Efraimidis–Spirakis) with a stable ascending-ordinal tie-break — so a fixed
 * `(seed, recent, rankingSnapshot, shuffleSeed, exclude)` yields a byte-identical
 * sequence, while a fresh random `shuffleSeed` gives intrinsic variety.
 */

import { EMPTY_NEIGHBOR_HOT, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";

const NEIGHBORS_PER_TRACK = 3;
const REVERSE_EDGE_WEIGHT = 2;
const HOP_DECAY = 0.7;

/** Stop expanding once admission would yield this multiple of what was asked for. */
const SUFFICIENCY_FACTOR = 3;
const FRONTIER_CAP = 256;
const STYLE_SEED_SAMPLE = 32;
const TASTE_SEED_SAMPLE = 16;
const DEFAULT_LIMIT = 200;

/**
 * What aims a station and what lets it roam — every weight that trades "sounds like what you asked
 * for" against "explores", in one place, so the trade-off is a stated policy rather than a set of
 * constants that happen to be what they are.
 *
 * The weights are relative to each other, not absolute: the final order is a weighted permutation
 * keyed by `-log(u) / score`, which is invariant under a uniform scaling of every score, and the
 * Not-for-me down-weight is multiplicative. So only the ratios below carry meaning.
 */
export interface StationBalance {
  /**
   * Seed weight of the thing the listener actually asked for — the song, the style sample, or the
   * Taste sample. Deliberately smaller than {@link recentWeight}: it is the station's memory of where
   * it started, and it has to keep pulling for the whole session without pinning the walk to one
   * point (that is what made a station run out after ~1.4k tracks).
   */
  originWeight: number;
  /** Seed weight of the most recently played track, before {@link recencyDecay}. */
  recentWeight: number;
  /** Geometric decay applied at each step back through {@link StationEngineOptions.recent}. */
  recencyDecay: number;
  /** How many recently played tracks the query drifts with. */
  recentWindow: number;
  /** Seed weight each sampled liked tune adds on a Song or Style station. */
  likeSteerWeight: number;
  /**
   * How many likes steer at once (diversity-sampled, D12).
   *
   * Unbounded steering is what collapses a station onto the likes: a listener with 200 likes would
   * otherwise contribute 200 seeds against one origin and a handful of recent tracks, and every
   * station would converge on the same favourites whatever it was asked for. A bounded, shuffle-seed
   * diversity sample keeps the total taste pull comparable to the recency pull.
   */
  likeSteerSample: number;
  /**
   * What fraction of its score a track keeps for each neighbouring tune the listener rejected.
   *
   * Multiplicative rather than a flat subtraction: seed mass differs by more than an order of
   * magnitude between a Song station (one seed) and a Style station (32), so a fixed penalty that
   * halves a candidate on the former moved it by ~2% on the latter. Rejections compound.
   */
  rejectNeighbourhoodScale: number;
  /** Hops the walk takes before it even looks at the yield. */
  minHops: number;
  /**
   * How far the walk may go when {@link minHops} does not yield enough.
   *
   * Admission drops a lot: the seeds themselves, everything already played, anything the style filter
   * rejects, and — since tunes under a few seconds are sound effects rather than music — anything too
   * short. Each of those can empty a neighbourhood that the graph itself has not exhausted at all, so
   * the walk keeps going while it is short of candidates and the frontier still has somewhere to go.
   * It costs nothing on a healthy station, because the loop stops as soon as the yield is sufficient.
   */
  maxHops: number;
}

/**
 * The shipped balance.
 *
 * `recentWindow`, `recencyDecay`, `originWeight` and `maxHops` were each chosen by sweeping them over
 * the pinned 0.8.0 bundle with `scripts/sidRadio/measure-station-depth.ts --sweep`, which drives the
 * real {@link computeStation} through the real queue provider and reports both how deep a station
 * gets before reporting itself exhausted and how far it steps between consecutive tunes. Depth
 * saturates for every drifting arm at ~59k of the corpus's 61,157 files, so the step distance is what
 * separates them:
 *
 *  - `recentWindow` 3 over 5, 8 and 12: consecutive tunes are one neighbour edge apart 3.1% of the
 *    time and within two hops 15.2%, against 2.9%/13.9% at 5 and 2.8%/14.1% at 12 (40 stations). It
 *    costs 0.8% of the p10 depth, which is 58,876 tracks.
 *  - `recencyDecay` 0.4 over 0.6 and 0.85: 3.3%/15.6% against 2.9%/13.9% and 2.5%/12.5%.
 *  - `originWeight` 0.35 over 0.15 and 1: equal step distance, best p10 depth (59,326 against 57,643
 *    and 56,748). It must be non-zero — at 0 the first compute has no seed mass at all, every score
 *    is 0, and the station reports itself exhausted before playing anything.
 *  - `maxHops` 8, unchanged: the widening loop is still needed and a smaller radius is neither
 *    cheaper nor more coherent. At 3 (no widening) one station in 40 died after 390 tracks; 4, 6 and 8
 *    are indistinguishable in step distance and wall-clock, and depth still rises with the budget
 *    (48,864 → 56,671 → 58,971 → 59,036 → 59,704 for 2, 3, 4, 6, 8).
 */
export const DEFAULT_STATION_BALANCE: StationBalance = {
  originWeight: 0.35,
  recentWeight: 1,
  recencyDecay: 0.4,
  recentWindow: 3,
  likeSteerWeight: 0.35,
  likeSteerSample: 8,
  rejectNeighbourhoodScale: 0.35,
  minHops: 3,
  maxHops: 8,
};

export type StationSeedKind = "song" | "style" | "taste";

export interface StationSeed {
  kind: StationSeedKind;
  /** Song seed: the md5_48 to start from. */
  md5_48?: string;
  /** Style seed: the style-mask bit to draw the broad seed pool from. */
  styleBit?: number;
}

export type StationReason = "similar" | "style" | "taste" | "discovery";

export interface StationEngineOptions {
  bundle: SidcorrTinyBundle;
  seed: StationSeed;
  /** Optional composed style constraint (admission), independent of the seed (D10). */
  styleFilter?: number | null;
  /** Full MD5s the user liked (steer + Taste seed). */
  likes?: string[];
  /** Full MD5s the user marked Not-for-me (hard-exclude + neighbourhood down-weight). */
  notForMe?: string[];
  /** The variety knob — a deterministic weighted permutation seed. */
  shuffleSeed: number;
  /** Track ordinals already played/queued, to skip (dedupe). */
  exclude?: Iterable<number>;
  /**
   * Recently played track ordinals, **most recent first** — the drifting half of the query.
   *
   * Order is load-bearing (the weight decays along it) and is therefore always supplied by the
   * caller; the engine never derives it from `exclude`, whose iteration order would only be the
   * consumption order by accident.
   */
  recent?: readonly number[];
  /** Overrides for the aim/roam trade-off (see {@link DEFAULT_STATION_BALANCE}). */
  balance?: Partial<StationBalance>;
  /** Max candidates to emit. */
  limit?: number;
  /**
   * Extra admission test, applied to a track ordinal.
   *
   * Used for the minimum-length rule: a tune of a second or two is a sound effect, not music, and a
   * station that plays them feels broken. The engine takes it as a predicate rather than a duration
   * table because durations live outside the similarity bundle — but it must be applied HERE, not
   * only after the fact, or the walk stops widening while it still could.
   */
  admit?: (trackOrdinal: number) => boolean;
}

export interface StationCandidate {
  trackOrdinal: number;
  md5_48: string;
  songIndex: number;
  score: number;
  reason: StationReason;
  /**
   * Every track ordinal of the same `.sid` file, this candidate included.
   *
   * A listener hears subsongs 1, 2 and 3 of one file as the same tune three times, so the queue
   * provider retires the whole file when it consumes one of its subsongs. It is carried here because
   * the file→track mapping lives in the bundle, which only the worker holds.
   */
  fileTrackOrdinals: number[];
}

export interface StationResult {
  candidates: StationCandidate[];
  /** Present when nothing could be produced. */
  empty?: "no-neighbours" | "exhausted";
}

const hashSeed = (a: number, b: number): number => {
  let h = (2166136261 ^ (a >>> 0)) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  h = (h ^ (b >>> 0)) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  return h >>> 0;
};

/** Deterministic per-(shuffleSeed, ordinal) uniform in (0,1). */
const perOrdinalRandom = (shuffleSeed: number, ordinal: number): number => {
  const t = (hashSeed(shuffleSeed, ordinal) + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
};

const md5sToOrdinals = (bundle: SidcorrTinyBundle, md5s: readonly string[]): number[] => {
  const out: number[] = [];
  for (const md5 of md5s) {
    for (const ordinal of bundle.trackOrdinalsForMd548(md5.slice(0, 12))) out.push(ordinal);
  }
  return out;
};

const reasonFor = (kind: StationSeedKind): StationReason =>
  kind === "song" ? "similar" : kind === "taste" ? "taste" : "style";

/** Deterministically sample up to `count` ordinals with a given style bit. */
const sampleStyleOrdinals = (
  bundle: SidcorrTinyBundle,
  styleBit: number,
  shuffleSeed: number,
  count: number,
): number[] => {
  const mask = 1 << styleBit;
  const keyed: Array<{ ordinal: number; key: number }> = [];
  for (let ordinal = 0; ordinal < bundle.trackCount; ordinal += 1) {
    if ((bundle.styleMask[ordinal] & mask) === 0) continue;
    keyed.push({ ordinal, key: perOrdinalRandom(shuffleSeed, ordinal) });
  }
  keyed.sort((a, b) => a.key - b.key || a.ordinal - b.ordinal);
  return keyed.slice(0, count).map((entry) => entry.ordinal);
};

/** Deterministic diversity sample of `ordinals` (spreads via the shuffleSeed, D12). */
const diversitySample = (ordinals: number[], shuffleSeed: number, count: number): number[] => {
  if (ordinals.length <= count) return [...ordinals];
  return ordinals
    .map((ordinal) => ({ ordinal, key: perOrdinalRandom(shuffleSeed, ordinal) }))
    .sort((a, b) => a.key - b.key || a.ordinal - b.ordinal)
    .slice(0, count)
    .map((entry) => entry.ordinal);
};

const capFrontier = (frontier: Map<number, number>, cap: number): Map<number, number> => {
  if (frontier.size <= cap) return frontier;
  const top = [...frontier.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, cap);
  return new Map(top);
};

export const computeStation = (options: StationEngineOptions): StationResult => {
  const { bundle, seed, shuffleSeed } = options;
  const balance: StationBalance = { ...DEFAULT_STATION_BALANCE, ...options.balance };
  const styleFilter = options.styleFilter ?? null;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const exclude = new Set<number>(options.exclude ?? []);
  const likeOrdinals = md5sToOrdinals(bundle, options.likes ?? []);
  const notForMeOrdinals = md5sToOrdinals(bundle, options.notForMe ?? []);
  const admit = options.admit;

  // 1. Seed ordinals + initial strengths. `primaryExclude` are the "you started
  // here" seeds we must not replay; likes-steer / style-sample seeds may appear.
  const seedStrength = new Map<number, number>();
  const primaryExclude = new Set<number>();
  const addSeed = (ordinal: number, weight: number) =>
    seedStrength.set(ordinal, (seedStrength.get(ordinal) ?? 0) + weight);

  if (seed.kind === "song") {
    if (!seed.md5_48) return { candidates: [], empty: "no-neighbours" };
    const ordinals = bundle.trackOrdinalsForMd548(seed.md5_48);
    if (ordinals.length === 0) return { candidates: [], empty: "no-neighbours" };
    for (const ordinal of ordinals) {
      addSeed(ordinal, balance.originWeight);
      primaryExclude.add(ordinal);
    }
  } else if (seed.kind === "taste") {
    if (likeOrdinals.length === 0) return { candidates: [], empty: "no-neighbours" };
    // Diversity-sampled subset of Likes so one composer/cluster can't dominate (D12).
    const sampled = diversitySample(likeOrdinals, shuffleSeed, TASTE_SEED_SAMPLE);
    for (const ordinal of sampled) {
      addSeed(ordinal, balance.originWeight);
      primaryExclude.add(ordinal);
    }
  } else {
    // style seed: a deterministic broad sample (likes steer below).
    const styleBit = seed.styleBit ?? styleFilter ?? 0;
    const sample = sampleStyleOrdinals(bundle, styleBit, shuffleSeed, STYLE_SEED_SAMPLE);
    if (sample.length === 0 && likeOrdinals.length === 0) return { candidates: [], empty: "no-neighbours" };
    for (const ordinal of sample) addSeed(ordinal, balance.originWeight);
  }

  // Likes always steer (§1): song/style stations gain a bounded, diversity-sampled
  // subset of the liked tunes as extra steer-seeds (Taste already seeds from likes).
  // A liked tune that is also a primary seed is thereby boosted.
  if (seed.kind !== "taste") {
    for (const ordinal of diversitySample(likeOrdinals, shuffleSeed, balance.likeSteerSample)) {
      addSeed(ordinal, balance.likeSteerWeight);
    }
  }

  // The drifting half of the query: what the listener just heard, decaying with age. A resumed
  // session can carry ordinals from a differently-sized bundle, so range-check before seeding —
  // an out-of-range ordinal would read past `neighborTargets` and score `undefined`.
  let recentWeight = balance.recentWeight;
  for (const ordinal of (options.recent ?? []).slice(0, balance.recentWindow)) {
    if (ordinal >= 0 && ordinal < bundle.trackCount) addSeed(ordinal, recentWeight);
    recentWeight *= balance.recencyDecay;
  }

  // 2. BFS scoring over forward + reverse edges, widened between `minHops` and `maxHops` while the
  // yield is thin. `admissibleCount` applies the same test admission does below, so "enough" means
  // enough of the RIGHT tracks, not merely enough reached.
  const scores = new Map<number, number>();
  let frontier = new Map(seedStrength);
  const excludeForCount = new Set<number>(exclude);
  for (const ordinal of primaryExclude) excludeForCount.add(ordinal);
  for (const ordinal of notForMeOrdinals) excludeForCount.add(ordinal);
  const styleMaskBitForCount = styleFilter !== null ? 1 << styleFilter : 0;
  const admissible = (ordinal: number, score: number): boolean => {
    if (score <= 0 || excludeForCount.has(ordinal)) return false;
    if (styleFilter !== null && (bundle.styleMask[ordinal] & styleMaskBitForCount) === 0) return false;
    return admit ? admit(ordinal) : true;
  };
  const enough = Math.max(limit, 1) * SUFFICIENCY_FACTOR;
  let hop = 0;
  while (hop < balance.maxHops && frontier.size > 0) {
    const decay = Math.pow(HOP_DECAY, hop);
    const next = new Map<number, number>();
    const bump = (ordinal: number, weight: number) => {
      scores.set(ordinal, (scores.get(ordinal) ?? 0) + weight);
      next.set(ordinal, (next.get(ordinal) ?? 0) + weight);
    };
    for (const [ordinal, strength] of frontier) {
      for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
        const target = bundle.neighborTargets[ordinal * NEIGHBORS_PER_TRACK + slot];
        if (target === EMPTY_NEIGHBOR_HOT) continue;
        bump(target, strength * (NEIGHBORS_PER_TRACK - slot) * decay);
      }
      for (const source of bundle.reverseSourcesOf(ordinal)) {
        bump(source, strength * REVERSE_EDGE_WEIGHT * decay);
      }
    }
    frontier = capFrontier(next, FRONTIER_CAP);
    hop += 1;
    if (hop >= balance.minHops) {
      let admissibleCount = 0;
      for (const [ordinal, score] of scores) {
        if (admissible(ordinal, score)) {
          admissibleCount += 1;
          if (admissibleCount >= enough) break;
        }
      }
      if (admissibleCount >= enough) break;
    }
  }

  // 3. Not-for-me down-weight (future refills only, D8) — the neighbourhood of a rejected tune keeps
  // only `rejectNeighbourhoodScale` of its score, per rejection. It is never banned: a rejection says
  // "not this tune", and the tunes around it are the best evidence available about what else the
  // listener may not want, not a region to delete.
  const scaleDown = (ordinal: number) => {
    const score = scores.get(ordinal);
    if (score !== undefined) scores.set(ordinal, score * balance.rejectNeighbourhoodScale);
  };
  for (const ordinal of notForMeOrdinals) {
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const target = bundle.neighborTargets[ordinal * NEIGHBORS_PER_TRACK + slot];
      if (target !== EMPTY_NEIGHBOR_HOT) scaleDown(target);
    }
    for (const source of bundle.reverseSourcesOf(ordinal)) scaleDown(source);
  }

  // 4. Admission: drop seeds, not-for-me, already-played; apply the style filter.
  const excludeAll = new Set<number>(exclude);
  for (const ordinal of primaryExclude) excludeAll.add(ordinal);
  for (const ordinal of notForMeOrdinals) excludeAll.add(ordinal);
  const styleMaskBit = styleFilter !== null ? 1 << styleFilter : 0;

  const admitted: Array<{ ordinal: number; score: number }> = [];
  for (const [ordinal, score] of scores) {
    if (score <= 0 || excludeAll.has(ordinal)) continue;
    if (styleFilter !== null && (bundle.styleMask[ordinal] & styleMaskBit) === 0) continue;
    if (admit && !admit(ordinal)) continue;
    admitted.push({ ordinal, score });
  }
  if (admitted.length === 0) return { candidates: [], empty: "exhausted" };

  // 5. Deterministic weighted permutation (shuffleSeed) + ascending-ordinal tie-break.
  const keyed = admitted.map(({ ordinal, score }) => {
    const random = perOrdinalRandom(shuffleSeed, ordinal);
    const key = -Math.log(random + 1e-12) / Math.max(score, 1e-6);
    return { ordinal, score, key };
  });
  keyed.sort((a, b) => a.key - b.key || a.ordinal - b.ordinal);

  const reason = reasonFor(seed.kind);
  const candidates = keyed.slice(0, limit).map(({ ordinal, score }) => {
    const track = bundle.resolveTrack(ordinal);
    return {
      trackOrdinal: ordinal,
      md5_48: track.md5_48,
      songIndex: track.songIndex,
      score,
      reason,
      fileTrackOrdinals: bundle.trackOrdinalsForMd548(track.md5_48),
    };
  });
  return { candidates };
};
