/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How long a SID Radio station actually lasts, measured on the pinned similarity bundle.
 *
 * Run:
 *   npx vite-node --script scripts/sidRadio/measure-station-depth.ts -- --stations=60 --cap=25000
 *   npx vite-node --script scripts/sidRadio/measure-station-depth.ts -- --sweep --stations=12
 *
 * It drives the **production** {@link StationQueueProvider} over the **production**
 * {@link computeStation} against `public/data/sidcorr/hvsc-tiny.sidcorr`, exactly as `useSidRadio`
 * does, and reports per station: how many distinct tracks were served before the station reported
 * itself exhausted, how many consecutive pairs came from the same `.sid` file, and whether any track
 * was served twice.
 *
 * Two things the real client applies are deliberately absent, so every depth here is an **upper
 * bound** on what a device would serve:
 *
 *   - the minimum-length filter (`minSeconds`), because songlengths live in the HVSC index rather
 *     than in the similarity bundle;
 *   - `md5_48 → virtualPath` resolution, which drops tunes the installed HVSC does not contain.
 *
 * Both only ever remove tracks, so they can lower a depth and never raise it.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { EMPTY_NEIGHBOR_HOT, parseSidcorrTiny, type SidcorrTinyBundle } from "@/lib/sidRadio/sidcorrTiny";
import {
  DEFAULT_STATION_BALANCE,
  computeStation,
  type StationBalance,
  type StationSeed,
} from "@/lib/sidRadio/stationEngine";
import { StationQueueProvider } from "@/lib/sidRadio/stationQueueProvider";
import { SIDCORR_BUNDLE_PUBLIC_PATH } from "@/lib/sidRadio/sidcorrRelease";

/** Matches `useSidRadio`'s LOOKAHEAD, so the provider is driven at the cadence the app drives it. */
const REFILL_LOOKAHEAD = 10;

export interface StationRunOutcome {
  /** Distinct tracks served before the station reported itself exhausted. */
  served: number;
  /** Consecutive served pairs that came from the same `.sid` file. */
  sameFileAdjacent: number;
  /** Served tracks whose `.sid` file had already been served earlier in the session, at any distance. */
  sameFileAnywhere: number;
  /** Tracks served more than once (must always be 0). */
  duplicates: number;
  /** Consecutive pairs one undirected neighbour edge apart, over the first {@link COHERENCE_PAIRS}. */
  oneHopSteps: number;
  /** Consecutive pairs two undirected hops apart. */
  twoHopSteps: number;
  /** Consecutive pairs sharing at least one style-mask bit. */
  sharedStyleSteps: number;
  /** Consecutive pairs the coherence figures were measured over. */
  coherencePairs: number;
  /** True when the run stopped at `cap` rather than at an exhausted station. */
  cappedOut: boolean;
}

export interface StationRunOptions {
  cap: number;
  /** False reproduces the fixed-seed station E1 replaced. */
  drift: boolean;
  /** False reproduces the track-level-only dedupe E2 replaced. */
  retireSiblings: boolean;
  balance?: Partial<StationBalance>;
}

export interface DepthMeasurement {
  label: string;
  stations: number;
  cap: number;
  balance: StationBalance;
  servedMedian: number;
  servedP10: number;
  servedP90: number;
  servedMin: number;
  cappedOut: number;
  /** Same-file adjacency as a fraction of all consecutive pairs, over every station. */
  sameFileAdjacentRate: number;
  sameFileAnywhereRate: number;
  duplicates: number;
  oneHopStepRate: number;
  withinTwoHopStepRate: number;
  sharedStyleStepRate: number;
  elapsedMs: number;
}

const percentile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
};

/** Deterministic 32-bit mixer, so the sampled seed songs are reproducible run to run. */
const mix = (value: number): number => {
  let h = (value ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
};

export const loadPinnedBundle = (): SidcorrTinyBundle => {
  const file = path.resolve(process.cwd(), "public", SIDCORR_BUNDLE_PUBLIC_PATH);
  const data = readFileSync(file);
  return parseSidcorrTiny(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
};

interface ServedTrack {
  trackOrdinal: number;
  md5_48: string;
}

const NEIGHBORS_PER_TRACK = 3;

/** Consecutive pairs per station the step-distance figures are measured over. */
const COHERENCE_PAIRS = 400;

/** Every track one undirected neighbour edge away — a forward slot or a reverse-CSR source. */
const adjacentTo = (bundle: SidcorrTinyBundle, ordinal: number): number[] => {
  const out: number[] = [];
  for (let slot = 0; slot < NEIGHBORS_PER_TRACK; slot += 1) {
    const target = bundle.neighborTargets[ordinal * NEIGHBORS_PER_TRACK + slot];
    if (target !== EMPTY_NEIGHBOR_HOT) out.push(target);
  }
  out.push(...bundle.reverseSourcesOf(ordinal));
  return out;
};

/**
 * How far a station steps between consecutive tunes.
 *
 * Depth alone cannot choose a hop budget or an origin weight, because every drifting arm serves
 * essentially the whole corpus. This is the other half of the trade-off: a station that steps to a
 * direct neighbour sounds like it is exploring a neighbourhood, one that jumps four hops sounds like
 * shuffle. Two hops is as far as this looks, because past that the answer is "somewhere else".
 */
const stepDistance = (bundle: SidcorrTinyBundle, from: number, to: number): 1 | 2 | 3 => {
  const firstRing = adjacentTo(bundle, from);
  if (firstRing.includes(to)) return 1;
  for (const middle of firstRing) {
    if (adjacentTo(bundle, middle).includes(to)) return 2;
  }
  return 3;
};

const tally = (bundle: SidcorrTinyBundle, order: ServedTrack[], cappedOut: boolean): StationRunOutcome => {
  const seen = new Set<number>();
  const seenFiles = new Set<string>();
  let duplicates = 0;
  let sameFileAdjacent = 0;
  let sameFileAnywhere = 0;
  let oneHopSteps = 0;
  let twoHopSteps = 0;
  let sharedStyleSteps = 0;
  let coherencePairs = 0;
  let previous: ServedTrack | null = null;
  for (const track of order) {
    if (seen.has(track.trackOrdinal)) duplicates += 1;
    seen.add(track.trackOrdinal);
    if (previous) {
      if (track.md5_48 === previous.md5_48) sameFileAdjacent += 1;
      // A two-hop search costs ~40 adjacency reads per pair, so it runs over a prefix rather than the
      // whole run; the step distribution is stationary long before the prefix ends.
      if (coherencePairs < COHERENCE_PAIRS) {
        const distance = stepDistance(bundle, previous.trackOrdinal, track.trackOrdinal);
        if (distance === 1) oneHopSteps += 1;
        else if (distance === 2) twoHopSteps += 1;
        if ((bundle.styleMask[previous.trackOrdinal] & bundle.styleMask[track.trackOrdinal]) !== 0) {
          sharedStyleSteps += 1;
        }
        coherencePairs += 1;
      }
    }
    if (seenFiles.has(track.md5_48)) sameFileAnywhere += 1;
    seenFiles.add(track.md5_48);
    previous = track;
  }
  return {
    served: order.length,
    sameFileAdjacent,
    sameFileAnywhere,
    duplicates,
    oneHopSteps,
    twoHopSteps,
    sharedStyleSteps,
    coherencePairs,
    cappedOut,
  };
};

/**
 * Play one station to exhaustion (or to `cap`) through the production queue provider.
 *
 * The two "before" switches are applied to the engine's answer rather than to the provider, so the
 * baseline and the measured result run through exactly the same production consume loop:
 *
 *  - `drift: false` withholds the recent-track seeds, which is the fixed-seed station E1 replaced;
 *  - `retireSiblings: false` shrinks each candidate's file to the candidate itself, which is the
 *    track-level-only dedupe E2 replaced.
 */
export const runStation = async (
  bundle: SidcorrTinyBundle,
  seed: StationSeed,
  shuffleSeed: number,
  options: StationRunOptions,
): Promise<StationRunOutcome> => {
  const order: ServedTrack[] = [];
  const provider = new StationQueueProvider({
    lookahead: REFILL_LOOKAHEAD,
    // The provider decides how much history to send and the engine decides how much of it to use, so
    // a swept window has to reach both or the provider silently clamps the arm to the shipped value.
    recentWindow: options.balance?.recentWindow ?? DEFAULT_STATION_BALANCE.recentWindow,
    computeCandidates: async (exclude, recent, count) => {
      const result = computeStation({
        bundle,
        seed,
        shuffleSeed,
        exclude,
        recent: options.drift ? recent : [],
        balance: options.balance,
        limit: count,
      });
      if (options.retireSiblings) return result;
      return {
        ...result,
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          fileTrackOrdinals: [candidate.trackOrdinal],
        })),
      };
    },
    resolvePath: (md5_48) => `/${md5_48}.sid`,
    buildItem: ({ virtualPath, trackOrdinal, md5_48 }) => {
      order.push({ trackOrdinal, md5_48 });
      return { id: `radio:${trackOrdinal}`, path: virtualPath } as never;
    },
  });

  for (;;) {
    const { items, reason } = await provider.refill(REFILL_LOOKAHEAD);
    if (reason || items.length === 0) break;
    if (order.length >= options.cap) return tally(bundle, order, true);
  }
  return tally(bundle, order, false);
};

export const measureDepth = async (
  bundle: SidcorrTinyBundle,
  options: StationRunOptions & { label: string; stations: number },
): Promise<DepthMeasurement> => {
  const startedAt = Date.now();
  const served: number[] = [];
  let sameFileAdjacent = 0;
  let sameFileAnywhere = 0;
  let duplicates = 0;
  let cappedOut = 0;
  let consecutivePairs = 0;
  let oneHopSteps = 0;
  let twoHopSteps = 0;
  let sharedStyleSteps = 0;
  let coherencePairs = 0;

  for (let index = 0; index < options.stations; index += 1) {
    const fileOrdinal = mix(index + 1) % bundle.fileCount;
    const seed: StationSeed = { kind: "song", md5_48: bundle.md548ByFileOrdinal[fileOrdinal] };
    const outcome = await runStation(bundle, seed, mix(index + 0x5bf03635), options);
    served.push(outcome.served);
    sameFileAdjacent += outcome.sameFileAdjacent;
    sameFileAnywhere += outcome.sameFileAnywhere;
    duplicates += outcome.duplicates;
    if (outcome.cappedOut) cappedOut += 1;
    consecutivePairs += Math.max(0, outcome.served - 1);
    oneHopSteps += outcome.oneHopSteps;
    twoHopSteps += outcome.twoHopSteps;
    sharedStyleSteps += outcome.sharedStyleSteps;
    coherencePairs += outcome.coherencePairs;
  }

  const sorted = [...served].sort((a, b) => a - b);
  return {
    label: options.label,
    stations: options.stations,
    cap: options.cap,
    balance: { ...DEFAULT_STATION_BALANCE, ...options.balance },
    servedMedian: percentile(sorted, 0.5),
    servedP10: percentile(sorted, 0.1),
    servedP90: percentile(sorted, 0.9),
    servedMin: sorted[0] ?? 0,
    cappedOut,
    sameFileAdjacentRate: consecutivePairs === 0 ? 0 : sameFileAdjacent / consecutivePairs,
    sameFileAnywhereRate: consecutivePairs === 0 ? 0 : sameFileAnywhere / consecutivePairs,
    duplicates,
    oneHopStepRate: coherencePairs === 0 ? 0 : oneHopSteps / coherencePairs,
    withinTwoHopStepRate: coherencePairs === 0 ? 0 : (oneHopSteps + twoHopSteps) / coherencePairs,
    sharedStyleStepRate: coherencePairs === 0 ? 0 : sharedStyleSteps / coherencePairs,
    elapsedMs: Date.now() - startedAt,
  };
};

const reportLine = (measurement: DepthMeasurement): string =>
  [
    measurement.label.padEnd(42),
    `median ${String(measurement.servedMedian).padStart(6)}`,
    `p10 ${String(measurement.servedP10).padStart(6)}`,
    `p90 ${String(measurement.servedP90).padStart(6)}`,
    `min ${String(measurement.servedMin).padStart(6)}`,
    `capped ${measurement.cappedOut}/${measurement.stations}`,
    `same-file adj ${(measurement.sameFileAdjacentRate * 100).toFixed(3)}%`,
    `any ${(measurement.sameFileAnywhereRate * 100).toFixed(3)}%`,
    `dups ${measurement.duplicates}`,
    `1hop ${(measurement.oneHopStepRate * 100).toFixed(1)}%`,
    `<=2hop ${(measurement.withinTwoHopStepRate * 100).toFixed(1)}%`,
    `style ${(measurement.sharedStyleStepRate * 100).toFixed(1)}%`,
    `${(measurement.elapsedMs / 1000).toFixed(1)}s`,
  ].join("  ");

const numberArg = (name: string, fallback: number): number => {
  const raw = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.slice(name.length + 3), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type Arm = { label: string; drift: boolean; retireSiblings: boolean; balance?: Partial<StationBalance> };

const BASELINE: Arm = {
  label: "before: fixed seed, 8 hops, track dedupe",
  drift: false,
  retireSiblings: false,
  balance: { maxHops: 8, originWeight: 1, likeSteerSample: Number.MAX_SAFE_INTEGER },
};

const sweepArms = (): Arm[] => [
  BASELINE,
  ...[3, 5, 8, 12].map((recentWindow) => ({
    label: `drift N=${recentWindow}`,
    drift: true,
    retireSiblings: true,
    balance: { recentWindow, maxHops: 8 },
  })),
  ...[0.4, 0.6, 0.85].map((recencyDecay) => ({
    label: `drift decay=${recencyDecay}`,
    drift: true,
    retireSiblings: true,
    balance: { recencyDecay, maxHops: 8 },
  })),
  ...[0, 0.15, 0.35, 1].map((originWeight) => ({
    label: `drift origin=${originWeight}`,
    drift: true,
    retireSiblings: true,
    balance: { originWeight, maxHops: 8 },
  })),
  ...[2, 3, 4, 6, 8].map((maxHops) => ({
    label: `drift hops=${maxHops}`,
    drift: true,
    retireSiblings: true,
    balance: { minHops: Math.min(3, maxHops), maxHops },
  })),
];

/**
 * Write the persisted session descriptor a station reaches after serving `depth` tracks.
 *
 * A deep session is where the per-refill costs that scale with the exclusion set actually bite, and
 * no soak can reach it — 60,000 tracks is weeks of listening. Replaying a real run to that depth and
 * handing the device the descriptor puts the app in exactly the state a resumed deep session is in,
 * which is a state the resume path already has to serve correctly.
 *
 * The exclusions are the ordinals a real station really served, not a random sample: they are
 * graph-local clusters, so the engine's walk sees the same "my neighbourhood is used up" pressure a
 * genuine deep session applies.
 */
const emitSessions = async (bundle: SidcorrTinyBundle, depths: number[], outDir: string): Promise<void> => {
  mkdirSync(outDir, { recursive: true });
  const fileOrdinal = mix(1) % bundle.fileCount;
  const seed: StationSeed = { kind: "song", md5_48: bundle.md548ByFileOrdinal[fileOrdinal] };
  const shuffleSeed = mix(0x5bf03635);

  for (const depth of depths) {
    const served: number[] = [];
    const excluded: number[] = [];
    const provider = new StationQueueProvider({
      lookahead: REFILL_LOOKAHEAD,
      computeCandidates: async (exclude, recent, count) =>
        computeStation({ bundle, seed, shuffleSeed, exclude, recent, limit: count }),
      resolvePath: (md5_48) => `/${md5_48}.sid`,
      buildItem: ({ virtualPath, trackOrdinal }) => {
        served.push(trackOrdinal);
        return { id: `radio:${trackOrdinal}`, path: virtualPath } as never;
      },
    });
    for (;;) {
      const { items, reason } = await provider.refill(REFILL_LOOKAHEAD);
      if (reason || items.length === 0) break;
      if (served.length >= depth) break;
    }
    excluded.push(...provider.excludedOrdinals);
    const descriptor = {
      seedKind: "song",
      seedLabel: "depth probe",
      seed,
      styleFilter: null,
      shuffleSeed,
      rankingSnapshotId: "depth-probe",
      excludeOrdinals: excluded,
      recentOrdinals: provider.recentOrdinals,
    };
    const file = path.join(outDir, `session-${depth}.json`);
    writeFileSync(file, JSON.stringify(descriptor));
    process.stdout.write(
      `${file}: served ${served.length}, ${excluded.length} exclusions, ${statSync(file).size} bytes of JSON\n`,
    );
  }
};

const main = async (): Promise<void> => {
  const bundle = loadPinnedBundle();
  const emit = process.argv.find((argument) => argument.startsWith("--emit-sessions="));
  if (emit) {
    const depths = emit.slice("--emit-sessions=".length).split(",").map(Number).filter(Number.isFinite);
    const outArg = process.argv.find((argument) => argument.startsWith("--out="));
    await emitSessions(bundle, depths, outArg ? outArg.slice("--out=".length) : "tmp/deep-sessions");
    return;
  }
  const stations = numberArg("stations", 60);
  const cap = numberArg("cap", 25000);
  const arms: Arm[] = process.argv.includes("--sweep")
    ? sweepArms()
    : [BASELINE, { label: "after: drifting query, shipped balance", drift: true, retireSiblings: true }];

  process.stdout.write(
    `bundle: ${bundle.trackCount} tracks / ${bundle.fileCount} files / ${bundle.stats.edgeCount} edges\n` +
      `stations: ${stations}  cap: ${cap}\n\n`,
  );

  for (const arm of arms) {
    const measurement = await measureDepth(bundle, { ...arm, stations, cap });
    process.stdout.write(`${reportLine(measurement)}\n`);
  }
};

await main();
