/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * SID Radio observability counters (spec §9.4), mirrored to a hidden DOM blob
 * (`data-testid="sid-radio-stats"`) that the Pixel-4 HIL reads over CDP — exactly
 * as Live View exposes its A/V-sync stats. Same numbers double as an in-app
 * Diagnostics surface. Node-safe (no-ops without a DOM).
 */

import { SIDCORR_BUNDLE_SHA256, SIDCORR_RELEASE_TAG, SIDCORR_SCHEMA_VERSION } from "@/lib/sidRadio/sidcorrRelease";

export const SID_RADIO_STATS_TESTID = "sid-radio-stats";

/** How many emitted ordinals {@link SidRadioStats.emittedSequence} keeps. */
export const EMITTED_SEQUENCE_CAP = 512;

export interface SidRadioStats {
  bundleLoadMs: number;
  reverseIndexMs: number;
  firstCandidateMs: number | null;
  lastRefillMs: number | null;
  refillMainThreadMaxMs: number;
  skipToLaunchMs: number | null;
  queueLookahead: number;
  /**
   * Which corpus this run actually used.
   *
   * `corpusReleaseTag` and `corpusBundleSha256` come from the pin, `corpusGraphFlags` and
   * `corpusBinaryFormatVersion` from the bytes the device parsed. A run's evidence has to name the
   * corpus it ran against, and a device has to be checkable against the pin without a rebuild —
   * both of which were guesswork while the only record of the corpus was a constant in the source.
   */
  corpusReleaseTag: string;
  corpusBundleSha256: string;
  corpusSchemaVersion: string;
  corpusBinaryFormatVersion: number | null;
  corpusGraphFlags: number | null;
  candidatesEmitted: number;
  /**
   * Candidate accounting for the current station, split by why a candidate did not become an item.
   *
   * Without this the minimum-length rule cannot be told apart from the songlengths being unable to
   * answer: both leave the queue looking normal, and only one of them can put a three-second tune
   * in front of a listener. `unknownDurationAdmitted` is the one that matters — it counts tunes
   * admitted because their length could not be resolved, not because it was long enough.
   */
  candidatesTooShort: number;
  candidatesUnresolvedPath: number;
  unknownDurationAdmitted: number;
  /**
   * Engine computes issued per refill.
   *
   * A refill costs `count / yield` computes, not one. This is the multiplier that made a deep
   * station expensive (3.9 s against a 150 ms budget on the Pixel 4), so it is reported next to
   * `lastRefillMs` rather than inferred from it.
   */
  refillComputeCalls: number;
  /** Fraction of consumed candidates that became queued items, as a percentage. */
  candidateYieldPercent: number;
  tracksAutoAdvanced: number;
  skips: number;
  engineThreadIsMain: boolean;
  memoryEstimateBytes: number;
  stationActive: boolean;
  seedKind: "song" | "style" | "taste" | null;
  styleBit: number | null;
  shuffleSeed: number | null;
  /**
   * The first {@link EMITTED_SEQUENCE_CAP} emitted track ordinals — the `--shuffle-replay`
   * determinism proof (§9.3). A prefix is all that proof needs: the gate starts one station twice
   * with the same pinned `shuffleSeed` and compares `seq[:tracks]`, with `--soak-tracks` defaulting
   * to 30.
   */
  emittedSequence: number[];
  /**
   * True while a station drives the queue (§5.3).
   *
   * The station owns the play order, so Shuffle and Repeat are removed from the card and — more to
   * the point — taken out of the traversal itself by `resolveTraversalOrdering`. The two used to
   * disagree: the card stopped drawing them while the traversal went on reading the stored values.
   */
  transportShuffleDisabled: boolean;
  transportRepeatDisabled: boolean;
  // Local engine (§12.6) — populated only by Track B.
  renderMsPerSec: number | null;
  audioUnderruns: number;
  engineSwitchMs: number | null;
}

const initialStats = (): SidRadioStats => ({
  bundleLoadMs: 0,
  reverseIndexMs: 0,
  firstCandidateMs: null,
  lastRefillMs: null,
  refillMainThreadMaxMs: 0,
  skipToLaunchMs: null,
  queueLookahead: 0,
  corpusReleaseTag: SIDCORR_RELEASE_TAG,
  corpusBundleSha256: SIDCORR_BUNDLE_SHA256,
  corpusSchemaVersion: SIDCORR_SCHEMA_VERSION,
  corpusBinaryFormatVersion: null,
  corpusGraphFlags: null,
  candidatesEmitted: 0,
  candidatesTooShort: 0,
  candidatesUnresolvedPath: 0,
  unknownDurationAdmitted: 0,
  refillComputeCalls: 0,
  candidateYieldPercent: 100,
  tracksAutoAdvanced: 0,
  skips: 0,
  engineThreadIsMain: false,
  memoryEstimateBytes: 0,
  stationActive: false,
  seedKind: null,
  styleBit: null,
  shuffleSeed: null,
  emittedSequence: [],
  transportShuffleDisabled: false,
  transportRepeatDisabled: false,
  renderMsPerSec: null,
  audioUnderruns: 0,
  engineSwitchMs: null,
});

let stats: SidRadioStats = initialStats();

/**
 * Cached mirror node. The lookup is skipped while the node stays in the
 * document; re-querying on every write is pure overhead on a path that runs
 * while audio is playing.
 */
let mirrorElement: Element | null = null;

const writeToDom = (): void => {
  if (typeof document === "undefined" || !document.body) return;
  if (!mirrorElement?.isConnected) {
    mirrorElement = document.querySelector(`[data-testid="${SID_RADIO_STATS_TESTID}"]`);
  }
  if (!mirrorElement) {
    const created = document.createElement("div");
    created.setAttribute("data-testid", SID_RADIO_STATS_TESTID);
    created.hidden = true;
    created.style.display = "none";
    document.body.appendChild(created);
    mirrorElement = created;
  }
  mirrorElement.textContent = JSON.stringify(stats);
};

export const getSidRadioStats = (): SidRadioStats => stats;

/** Merge a partial update and mirror to the DOM. */
export const updateSidRadioStats = (patch: Partial<SidRadioStats>): void => {
  stats = { ...stats, ...patch };
  writeToDom();
};

/** Record a refill (aggregates the main-thread max, spec §9.2 `refillMainThreadMaxMs`). */
export const recordRefill = (input: {
  lastRefillMs: number;
  mainThreadMs: number;
  emitted: number;
  lookahead: number;
  firstCandidate?: boolean;
  /** Provider-side admission accounting, cumulative for the station (absent → left unchanged). */
  admission?: {
    tooShort: number;
    unresolvedPath: number;
    unknownDurationAdmitted: number;
    computeCalls: number;
    yieldPercent: number;
  };
}): void => {
  stats = {
    ...stats,
    // The initial station fill is the COLD path and is measured by
    // `firstCandidateMs`, which has its own (looser) budget. Letting it also set
    // `lastRefillMs` made the two alias: a run where no lookahead refill was
    // needed reported the cold number against the warm 150 ms budget and failed
    // as a false regression. `lastRefillMs` stays null until a real lookahead
    // refill happens, which the HIL reports as NOT REPORTED rather than green.
    lastRefillMs: input.firstCandidate ? stats.lastRefillMs : input.lastRefillMs,
    refillMainThreadMaxMs: Math.max(stats.refillMainThreadMaxMs, input.mainThreadMs),
    candidatesEmitted: stats.candidatesEmitted + input.emitted,
    // Cumulative on the provider already, so assigned rather than added — adding would square them.
    candidatesTooShort: input.admission?.tooShort ?? stats.candidatesTooShort,
    candidatesUnresolvedPath: input.admission?.unresolvedPath ?? stats.candidatesUnresolvedPath,
    unknownDurationAdmitted: input.admission?.unknownDurationAdmitted ?? stats.unknownDurationAdmitted,
    refillComputeCalls: input.admission?.computeCalls ?? stats.refillComputeCalls,
    candidateYieldPercent: input.admission?.yieldPercent ?? stats.candidateYieldPercent,
    queueLookahead: input.lookahead,
    firstCandidateMs:
      input.firstCandidate && stats.firstCandidateMs === null ? input.lastRefillMs : stats.firstCandidateMs,
  };
  writeToDom();
};

/** Record an auto-advance to the next track (spec §9.2 `tracksAutoAdvanced`). */
export const recordAutoAdvance = (): void => {
  stats = { ...stats, tracksAutoAdvanced: stats.tracksAutoAdvanced + 1 };
  writeToDom();
};

/**
 * Record a tune the station emitted into the queue, in emit order (§9.3).
 *
 * This is deliberately *not* driven by playback advancing. Emission order is a
 * pure function of `(seed, rankingSnapshot, shuffleSeed)`, which is precisely
 * what the G11 `--shuffle-replay` gate re-runs and compares; playback order is
 * not, because a listener skipping ahead outruns the refills and the two drift
 * apart. Recording this on auto-advance also meant recording the playlist
 * cursor -- 0,1,2,… for every seed -- so the comparison could never fail.
 */
export const recordEmitted = (trackOrdinal: number): void => {
  // Deliberately does NOT mirror to the DOM. This fires once per emitted item,
  // so a single refill calls it `lookahead` times in a tight synchronous loop --
  // and writeToDom does a querySelector plus a full JSON.stringify of the whole
  // stats object every time. Mirroring here put ten of those on the main thread
  // inside each refill, while audio was playing, and a 25-minute soak came back
  // with an audio underrun against a pinned budget of 0 where earlier runs had
  // none. The refill that emitted these items calls recordRefill immediately
  // afterwards, which flushes the sequence along with the rest.
  //
  // The copy is what bounds the sequence: appending immutably costs one copy of
  // the whole array per emitted track, which was ~1M element copies over the
  // ~1.4k tracks a station used to reach and would be 1.8 billion over the ~60k
  // it reaches now — sustained allocation churn on the thread rendering audio.
  if (stats.emittedSequence.length >= EMITTED_SEQUENCE_CAP) return;
  stats = { ...stats, emittedSequence: [...stats.emittedSequence, trackOrdinal] };
};

/** Record a ✕-skip and its launch latency (spec §9.2 `skipToLaunchMs`). */
export const recordSkip = (skipToLaunchMs: number): void => {
  // Keep the WORST skip, not the most recent one. The budget is a max bound, so
  // reporting whichever skip happened last would let a 25-skip soak pass or fail
  // on the luck of its final sample.
  stats = {
    ...stats,
    skips: stats.skips + 1,
    skipToLaunchMs: Math.max(stats.skipToLaunchMs ?? 0, skipToLaunchMs),
  };
  writeToDom();
};

/**
 * Clear the per-station counters, keeping what describes the corpus.
 *
 * The bundle's format version and graph flags are properties of the bytes this build loaded, not of
 * the station being started, and the load happens once while a station starts every time the
 * listener picks one. Resetting them here wiped the identity that had just been read and left the
 * device reporting a corpus it could not name.
 */
export const resetSidRadioStats = (): void => {
  const { corpusBinaryFormatVersion, corpusGraphFlags } = stats;
  stats = { ...initialStats(), corpusBinaryFormatVersion, corpusGraphFlags };
  writeToDom();
};

/** Read the DOM-mirrored stats back (HIL/CDP parity check). */
export const readSidRadioStatsFromDom = (): SidRadioStats | null => {
  if (typeof document === "undefined") return null;
  const element = document.querySelector(`[data-testid="${SID_RADIO_STATS_TESTID}"]`);
  if (!element?.textContent) return null;
  return JSON.parse(element.textContent) as SidRadioStats;
};
