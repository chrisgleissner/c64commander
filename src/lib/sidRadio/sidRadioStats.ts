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

export const SID_RADIO_STATS_TESTID = "sid-radio-stats";

export interface SidRadioStats {
  bundleLoadMs: number;
  reverseIndexMs: number;
  firstCandidateMs: number | null;
  lastRefillMs: number | null;
  refillMainThreadMaxMs: number;
  skipToLaunchMs: number | null;
  queueLookahead: number;
  candidatesEmitted: number;
  tracksAutoAdvanced: number;
  skips: number;
  engineThreadIsMain: boolean;
  memoryEstimateBytes: number;
  stationActive: boolean;
  seedKind: "song" | "style" | "taste" | null;
  styleBit: number | null;
  shuffleSeed: number | null;
  /** Emitted track-ordinal sequence — the `--shuffle-replay` determinism proof (§9.3). */
  emittedSequence: number[];
  /** True while a station drives the queue → transport Shuffle/Repeat are disabled (§5.3). */
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
  candidatesEmitted: 0,
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

const writeToDom = (): void => {
  if (typeof document === "undefined" || !document.body) return;
  let element = document.querySelector(`[data-testid="${SID_RADIO_STATS_TESTID}"]`);
  if (!element) {
    element = document.createElement("div");
    element.setAttribute("data-testid", SID_RADIO_STATS_TESTID);
    (element as HTMLElement).hidden = true;
    (element as HTMLElement).style.display = "none";
    document.body.appendChild(element);
  }
  element.textContent = JSON.stringify(stats);
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
}): void => {
  stats = {
    ...stats,
    lastRefillMs: input.lastRefillMs,
    refillMainThreadMaxMs: Math.max(stats.refillMainThreadMaxMs, input.mainThreadMs),
    candidatesEmitted: stats.candidatesEmitted + input.emitted,
    queueLookahead: input.lookahead,
    firstCandidateMs:
      input.firstCandidate && stats.firstCandidateMs === null ? input.lastRefillMs : stats.firstCandidateMs,
  };
  writeToDom();
};

/** Record an auto-advance to the next track (spec §9.2 `tracksAutoAdvanced`). */
export const recordAutoAdvance = (trackOrdinal: number): void => {
  stats = {
    ...stats,
    tracksAutoAdvanced: stats.tracksAutoAdvanced + 1,
    emittedSequence: [...stats.emittedSequence, trackOrdinal],
  };
  writeToDom();
};

/** Record a ✕-skip and its launch latency (spec §9.2 `skipToLaunchMs`). */
export const recordSkip = (skipToLaunchMs: number): void => {
  stats = { ...stats, skips: stats.skips + 1, skipToLaunchMs };
  writeToDom();
};

export const resetSidRadioStats = (): void => {
  stats = initialStats();
  writeToDom();
};

/** Read the DOM-mirrored stats back (HIL/CDP parity check). */
export const readSidRadioStatsFromDom = (): SidRadioStats | null => {
  if (typeof document === "undefined") return null;
  const element = document.querySelector(`[data-testid="${SID_RADIO_STATS_TESTID}"]`);
  if (!element?.textContent) return null;
  return JSON.parse(element.textContent) as SidRadioStats;
};
