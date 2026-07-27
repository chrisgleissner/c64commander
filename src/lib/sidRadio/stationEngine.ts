/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The station engine (spec §2.3) — a **pure, deterministic** function of
 * `(seed, rankingSnapshot, shuffleSeed)` that turns the similarity graph into an
 * ordered candidate stream. It runs off the main thread (in `sidRadio.worker.ts`).
 *
 * Traversal: seed → BFS over forward + reverse neighbour edges (the reverse CSR
 * built once at load, §2.3 step 1) → rank-weighted, hop-decayed scoring
 * (`Σ seedWeight × (neighbors − rank)`, §2.3 step 4). Likes raise the seed
 * weight; Not-for-me hard-excludes the tune and down-weights its neighbourhood
 * (future-refill only, D8). An optional style-mask filter admits candidates
 * (Style Radio / Style × Likes composition, D10).
 *
 * Determinism (G11): scoring is integer-rank based (D16 — the per-edge
 * similarity byte is intentionally unused). The only randomness is the explicit
 * `shuffleSeed`, applied as a deterministic **weighted permutation**
 * (Efraimidis–Spirakis) with a stable ascending-ordinal tie-break — so a fixed
 * `(seed, rankingSnapshot, shuffleSeed)` yields a byte-identical sequence, while
 * a fresh random `shuffleSeed` gives intrinsic variety.
 */

import { EMPTY_NEIGHBOR_HOT, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";

const NEIGHBORS_PER_TRACK = 3;
const BASE_SEED_WEIGHT = 1.0;
const LIKE_BOOST = 1.6;
const REVERSE_EDGE_WEIGHT = 2;
const HOP_DECAY = 0.7;
const MAX_HOPS = 3;
const FRONTIER_CAP = 256;
const NOT_FOR_ME_PENALTY = 2.5;
const STYLE_SEED_SAMPLE = 32;
const TASTE_SEED_SAMPLE = 16;
const DEFAULT_LIMIT = 200;

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
  /** Max candidates to emit. */
  limit?: number;
}

export interface StationCandidate {
  trackOrdinal: number;
  md5_48: string;
  songIndex: number;
  score: number;
  reason: StationReason;
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
  const styleFilter = options.styleFilter ?? null;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const exclude = new Set<number>(options.exclude ?? []);
  const likeOrdinals = md5sToOrdinals(bundle, options.likes ?? []);
  const notForMeOrdinals = md5sToOrdinals(bundle, options.notForMe ?? []);

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
      addSeed(ordinal, BASE_SEED_WEIGHT);
      primaryExclude.add(ordinal);
    }
  } else if (seed.kind === "taste") {
    if (likeOrdinals.length === 0) return { candidates: [], empty: "no-neighbours" };
    // Diversity-sampled subset of Likes so one composer/cluster can't dominate (D12).
    const sampled = diversitySample(likeOrdinals, shuffleSeed, TASTE_SEED_SAMPLE);
    for (const ordinal of sampled) {
      addSeed(ordinal, BASE_SEED_WEIGHT);
      primaryExclude.add(ordinal);
    }
  } else {
    // style seed: a deterministic broad sample (likes steer below).
    const styleBit = seed.styleBit ?? styleFilter ?? 0;
    const sample = sampleStyleOrdinals(bundle, styleBit, shuffleSeed, STYLE_SEED_SAMPLE);
    if (sample.length === 0 && likeOrdinals.length === 0) return { candidates: [], empty: "no-neighbours" };
    for (const ordinal of sample) addSeed(ordinal, BASE_SEED_WEIGHT);
  }

  // Likes always steer (§1): song/style stations gain the liked tunes as extra
  // steer-seeds (Taste already seeds from likes at full weight). A liked tune
  // that is also a primary seed is thereby boosted.
  if (seed.kind !== "taste") {
    const steerWeight = BASE_SEED_WEIGHT * (LIKE_BOOST - 1);
    for (const ordinal of likeOrdinals) addSeed(ordinal, steerWeight);
  }

  // 2. BFS scoring over forward + reverse edges.
  const scores = new Map<number, number>();
  let frontier = new Map(seedStrength);
  for (let hop = 0; hop < MAX_HOPS && frontier.size > 0; hop += 1) {
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
  }

  // 3. Not-for-me down-weight (future refills only, D8) — penalise the neighbourhood.
  for (const ordinal of notForMeOrdinals) {
    for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
      const target = bundle.neighborTargets[ordinal * NEIGHBORS_PER_TRACK + slot];
      if (target !== EMPTY_NEIGHBOR_HOT && scores.has(target)) {
        scores.set(target, (scores.get(target) ?? 0) - NOT_FOR_ME_PENALTY);
      }
    }
    for (const source of bundle.reverseSourcesOf(ordinal)) {
      if (scores.has(source)) scores.set(source, (scores.get(source) ?? 0) - NOT_FOR_ME_PENALTY);
    }
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
    return { trackOrdinal: ordinal, md5_48: track.md5_48, songIndex: track.songIndex, score, reason };
  });
  return { candidates };
};
