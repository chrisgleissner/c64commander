/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Latency no-drift analysis (spec §7, §14.6). Given a time-series of latency samples from a long
 * soak, it computes the evidence the spec demands that playback delay is NOT trending upward:
 *
 *   - every rolling one-minute window's p99 is below the hard budget,
 *   - the final window's p99 does not exceed the first window's p99 by more than a committed
 *     tolerance (derived from measurement noise, not silently widened to pass),
 *   - the linear-regression slope of latency over time stays within a committed tolerance.
 *
 * Pure and deterministic (no clock, no I/O): the caller supplies monotonic sample times so a soak
 * can be replayed at accelerated speed. Used by the soak test and, on device, by the HIL report.
 */

export interface LatencySample {
  /** Monotonic time of the sample (ms). */
  tMs: number;
  /** Latency at that time (ms). */
  latencyMs: number;
}

export interface DriftThresholds {
  /** Every rolling window's p99 must be below this (ms) — the hard latency budget. */
  maxRollingP99Ms: number;
  /** Rolling / comparison window length (ms). §7 uses one-minute rolling and five-minute end windows. */
  rollingWindowMs: number;
  /** End-comparison window length (ms) for the first-vs-last p99 check. */
  compareWindowMs: number;
  /** The last window's p99 may exceed the first window's by at most this (ms). */
  maxWindowDeltaMs: number;
  /** Linear latency-drift slope tolerance (ms per minute). */
  maxSlopeMsPerMin: number;
}

export interface DriftAnalysis {
  samples: number;
  durationMs: number;
  /** Max p99 across all rolling windows. */
  rollingP99MaxMs: number;
  firstWindowP99Ms: number;
  lastWindowP99Ms: number;
  /** lastWindowP99 − firstWindowP99. */
  windowDeltaMs: number;
  /** Linear-regression slope of latencyMs vs time, expressed in ms per minute. */
  slopeMsPerMin: number;
  /** Per-check results + overall pass. */
  rollingWithinBudget: boolean;
  windowDeltaWithinTolerance: boolean;
  slopeWithinTolerance: boolean;
  passed: boolean;
}

const percentile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
};

const p99Of = (values: number[]): number =>
  percentile(
    [...values].sort((a, b) => a - b),
    99,
  );

/** p99 of samples whose time is within [fromMs, toMs). */
const windowP99 = (samples: LatencySample[], fromMs: number, toMs: number): number => {
  const inWindow = samples.filter((s) => s.tMs >= fromMs && s.tMs < toMs).map((s) => s.latencyMs);
  return inWindow.length ? p99Of(inWindow) : 0;
};

/** Ordinary-least-squares slope of latency vs time (ms per ms). */
const slopePerMs = (samples: LatencySample[]): number => {
  const n = samples.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const s of samples) {
    sx += s.tMs;
    sy += s.latencyMs;
    sxx += s.tMs * s.tMs;
    sxy += s.tMs * s.latencyMs;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
};

/**
 * Analyse a latency series for progressive drift against committed thresholds. Returns the full
 * evidence set; `passed` is true only when the rolling budget, the first-vs-last window delta and
 * the regression slope are all within tolerance.
 */
export const analyzeLatencyDrift = (samples: LatencySample[], thresholds: DriftThresholds): DriftAnalysis => {
  const sorted = [...samples].sort((a, b) => a.tMs - b.tMs);
  const durationMs = sorted.length ? sorted[sorted.length - 1].tMs - sorted[0].tMs : 0;
  const startMs = sorted.length ? sorted[0].tMs : 0;
  const endMs = startMs + durationMs;

  // Rolling windows: step by half a window so a breach cannot slip between window edges.
  let rollingP99Max = 0;
  const step = Math.max(1, thresholds.rollingWindowMs / 2);
  for (let from = startMs; from < endMs; from += step) {
    rollingP99Max = Math.max(rollingP99Max, windowP99(sorted, from, from + thresholds.rollingWindowMs));
  }

  const firstWindowP99 = windowP99(sorted, startMs, startMs + thresholds.compareWindowMs);
  const lastWindowP99 = windowP99(sorted, endMs - thresholds.compareWindowMs, endMs + 1);
  const windowDelta = lastWindowP99 - firstWindowP99;
  const slopeMsPerMin = slopePerMs(sorted) * 60_000;

  const rollingWithinBudget = rollingP99Max < thresholds.maxRollingP99Ms;
  const windowDeltaWithinTolerance = windowDelta <= thresholds.maxWindowDeltaMs;
  const slopeWithinTolerance = slopeMsPerMin <= thresholds.maxSlopeMsPerMin;

  return {
    samples: sorted.length,
    durationMs,
    rollingP99MaxMs: rollingP99Max,
    firstWindowP99Ms: firstWindowP99,
    lastWindowP99Ms: lastWindowP99,
    windowDeltaMs: windowDelta,
    slopeMsPerMin,
    rollingWithinBudget,
    windowDeltaWithinTolerance,
    slopeWithinTolerance,
    passed: rollingWithinBudget && windowDeltaWithinTolerance && slopeWithinTolerance,
  };
};
