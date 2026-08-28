/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Keystroke to painted list, measured on the device (spec.md section 5.5).
 *
 * The budget is under 100 ms at p95 on the Pixel 4, and only the phone can settle it: a wall-clock
 * assertion in Vitest is a flake generator on a shared runner, and the deterministic work gate
 * beside it proves the ALGORITHM has not gone quadratic, not what the hardware does with it. So the
 * real number comes from a HIL stage that drives this probe.
 *
 * It is off unless something turns it on. Production pays one boolean read per keystroke.
 */

const PROBE_FLAG = "__c64uSearchLatencyProbe";
const SAMPLES = "__c64uSearchLatencySamples";

/** How many samples are kept, so a long run cannot grow without bound. */
export const LATENCY_SAMPLE_LIMIT = 500;

type ProbeWindow = Window & {
  [PROBE_FLAG]?: boolean;
  [SAMPLES]?: number[];
  __c64uTestProbeEnabled?: boolean;
};

const probeWindow = (): ProbeWindow | null => (typeof window === "undefined" ? null : window);

export const isSearchLatencyProbeEnabled = (): boolean => {
  const target = probeWindow();
  return target !== null && (target[PROBE_FLAG] === true || target.__c64uTestProbeEnabled === true);
};

let pendingKeystrokeAt: number | null = null;

/** Called from the field's own change handler, before React is asked to do anything. */
export const markSearchKeystroke = (): void => {
  if (!isSearchLatencyProbeEnabled()) return;
  pendingKeystrokeAt = performance.now();
};

/**
 * Called from a requestAnimationFrame scheduled by the effect that runs AFTER the results commit,
 * so the interval covers scoring, reconciliation and the paint that follows — the whole thing a
 * user waits through, rather than the part that is easy to measure.
 */
export const markSearchResultsPainted = (): void => {
  const target = probeWindow();
  if (target === null || pendingKeystrokeAt === null || !isSearchLatencyProbeEnabled()) return;
  const elapsed = performance.now() - pendingKeystrokeAt;
  pendingKeystrokeAt = null;
  const samples = target[SAMPLES] ?? [];
  samples.push(elapsed);
  target[SAMPLES] = samples.slice(-LATENCY_SAMPLE_LIMIT);
};

/** Nearest-rank p95, which is what the gate reports. Exported so the rule is testable. */
export const percentile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
};

export const __testing = {
  reset: () => {
    pendingKeystrokeAt = null;
    const target = probeWindow();
    if (target) delete target[SAMPLES];
  },
};
