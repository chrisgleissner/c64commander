/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Press-to-dispatch latency measurement for the remote-input relay: the
 * elapsed time from the user's gesture (pointerdown/pointerup driving a
 * held-set change) to the moment the resulting `machine:input` REST call is
 * actually issued. Kept as a ring buffer of recent samples rather than a
 * running average so a diagnostics view can inspect the distribution (p50/p95
 * matter more than the mean for "does this feel instant"), and so a test can
 * assert on exact recorded values.
 */

export type InputLatencySample = {
  /** Elapsed ms from the triggering gesture to the REST dispatch call. */
  latencyMs: number;
  /** Wall-clock time (performance.now()) the sample was recorded. */
  atMs: number;
};

const MAX_SAMPLES = 200;
const samples: InputLatencySample[] = [];

export const recordInputLatencySample = (latencyMs: number, atMs: number): void => {
  samples.push({ latencyMs, atMs });
  if (samples.length > MAX_SAMPLES) samples.shift();
};

export const getInputLatencySamples = (): readonly InputLatencySample[] => samples;

export const clearInputLatencySamples = (): void => {
  samples.length = 0;
};

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
};

export type InputLatencyStats = {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
};

export const getInputLatencyStats = (): InputLatencyStats => {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p95Ms: 0 };
  }
  const values = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    minMs: values[0],
    maxMs: values[values.length - 1],
    meanMs: sum / values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
  };
};
