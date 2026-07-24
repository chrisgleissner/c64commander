/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Clock mapping + latency-measurement integrity (spec §5.1, §5.4).
 *
 * The honest measurement position for this app (documented in docs/plans/live-view §0):
 *   - TRUE source→display latency cannot be measured, because the C64 Ultimate firmware does not
 *     embed a source timestamp in its UDP packets and there is no common-clock external fixture.
 *   - What CAN be measured precisely, each on a SINGLE monotonic clock (so no cross-clock mapping
 *     error enters):
 *       • A/V offset  — audio vs video wire-arrival, both stamped by the native System.nanoTime clock,
 *       • local pipeline residence — present-queue residence on the presentation clock,
 *       • input→display (press→see) — press and observe times on the same JS monotonic clock.
 *     Their uncertainty is just sampling quantisation + event-loop jitter (sub-millisecond to a few ms).
 *
 * This module provides (a) the two-clock mapping tools for the general case — offset, drift and a
 * QUANTIFIED residual uncertainty via least squares — should a future firmware/HIL fixture supply
 * paired source/device timestamps, and (b) {@link measurementUncertainty} for combining a metric's
 * value with a stated error bound so a latency gate is only asserted when the uncertainty is small
 * enough to distinguish the threshold (§5.1: below ~2 ms, else the gate must not be claimed proven).
 *
 * Pure and deterministic. All times are milliseconds on monotonic clocks (§5.4).
 */

export interface ClockPair {
  /** Time of the same event on the SOURCE clock (ms). Caller has already unwrapped any wraparound. */
  sourceMs: number;
  /** Time of that event on the DEVICE monotonic clock (ms). */
  deviceMs: number;
}

export interface ClockMapping {
  /** deviceMs ≈ scale·sourceMs + offsetMs. */
  scale: number;
  offsetMs: number;
  /** Clock drift relative to the source, in parts-per-million ((scale − 1)·1e6). */
  driftPpm: number;
  /** Standard deviation of the fit residuals (ms) — the 1σ mapping uncertainty. */
  residualStdMs: number;
  /** Worst-case fit residual (ms) — a conservative uncertainty bound. */
  residualMaxMs: number;
  samples: number;
}

/**
 * Least-squares fit of device time to source time, returning the offset, drift, and a quantified
 * residual uncertainty. Fewer than two pairs cannot establish drift → identity mapping, uncertainty
 * unknown (reported as +∞ so a gate cannot silently pass on it).
 */
export const fitClockMapping = (pairs: ClockPair[]): ClockMapping => {
  const n = pairs.length;
  if (n < 2) {
    return {
      scale: 1,
      offsetMs: n === 1 ? pairs[0].deviceMs - pairs[0].sourceMs : 0,
      driftPpm: 0,
      residualStdMs: Infinity,
      residualMaxMs: Infinity,
      samples: n,
    };
  }
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pairs) {
    sx += p.sourceMs;
    sy += p.deviceMs;
    sxx += p.sourceMs * p.sourceMs;
    sxy += p.sourceMs * p.deviceMs;
  }
  const denom = n * sxx - sx * sx;
  const scale = denom === 0 ? 1 : (n * sxy - sx * sy) / denom;
  const offsetMs = (sy - scale * sx) / n;

  let sumSq = 0;
  let maxAbs = 0;
  for (const p of pairs) {
    const residual = p.deviceMs - (scale * p.sourceMs + offsetMs);
    sumSq += residual * residual;
    maxAbs = Math.max(maxAbs, Math.abs(residual));
  }
  return {
    scale,
    offsetMs,
    driftPpm: (scale - 1) * 1e6,
    residualStdMs: Math.sqrt(sumSq / n),
    residualMaxMs: maxAbs,
    samples: n,
  };
};

/** Map a source-clock time onto the device clock using a fitted mapping. */
export const mapSourceToDevice = (sourceMs: number, mapping: ClockMapping): number =>
  mapping.scale * sourceMs + mapping.offsetMs;

export interface Measurement {
  valueMs: number;
  uncertaintyMs: number;
}

/**
 * Whether a measured latency can be ASSERTED against a threshold given its uncertainty (§5.1). A gate
 * is only defensible when the value plus its uncertainty is unambiguously on one side of the
 * threshold AND the uncertainty is below `maxUncertaintyMs` (default 2 ms) — otherwise the result is
 * "inconclusive" and must not be reported as proven.
 */
export const canAssertBelow = (
  m: Measurement,
  thresholdMs: number,
  maxUncertaintyMs = 2,
): "pass" | "fail" | "inconclusive" => {
  if (!Number.isFinite(m.uncertaintyMs) || m.uncertaintyMs > maxUncertaintyMs) return "inconclusive";
  if (m.valueMs + m.uncertaintyMs < thresholdMs) return "pass";
  if (m.valueMs - m.uncertaintyMs >= thresholdMs) return "fail";
  return "inconclusive";
};
