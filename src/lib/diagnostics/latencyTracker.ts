/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §12 — Latency tracking: rolling 5-minute window, p50/p90/p99 estimation.
// All percentile computation is deterministic for the same input sequence.

const WINDOW_MS = 5 * 60 * 1000;

/** Endpoint classes per §12.6 — grounded in existing request behavior. */
export type EndpointClass =
  | "Info"
  | "Configs (full tree)"
  | "Config items"
  | "Drives"
  | "Machine control"
  | "FTP list"
  | "FTP read"
  | "Other";

/** Transport family per §12.6 */
export type TransportFamily = "REST" | "FTP";

export type LatencySample = {
  timestampMs: number;
  durationMs: number;
  transport: TransportFamily;
  endpoint: EndpointClass;
};

export type LatencyPercentiles = {
  p50: number;
  p90: number;
  p99: number;
  sampleCount: number;
};

/** Derive endpoint class from a REST/FTP path per §12.6 */
export const classifyEndpoint = (transport: TransportFamily, path: string): EndpointClass => {
  if (transport === "FTP") {
    if (/^\/v1\/ftp\/list/i.test(path) || path === "/" || path === "") return "FTP list";
    if (/^\/v1\/ftp\/read/i.test(path)) return "FTP read";
    return "FTP list"; // default for FTP list operations
  }
  if (/^\/v1\/info\b/.test(path)) return "Info";
  if (/^\/v1\/configs$/.test(path)) return "Configs (full tree)";
  if (/^\/v1\/configs\//.test(path)) return "Config items";
  if (/^\/v1\/drives\b/.test(path)) return "Drives";
  if (/^\/v1\/(machine|runners|streams)\b/.test(path)) return "Machine control";
  return "Other";
};

const samples: LatencySample[] = [];

const prune = () => {
  const cutoff = Date.now() - WINDOW_MS;
  let i = 0;
  while (i < samples.length && samples[i].timestampMs < cutoff) i++;
  if (i > 0) samples.splice(0, i);
};

/** Record a latency sample. */
export const recordLatencySample = (transport: TransportFamily, path: string, durationMs: number): void => {
  prune();
  samples.push({
    timestampMs: Date.now(),
    durationMs,
    transport,
    endpoint: classifyEndpoint(transport, path),
  });
};

/** Clear all samples (e.g. on diagnostics clear). */
export const clearLatencySamples = (): void => {
  samples.splice(0);
};

/**
 * Compute exact percentile from a sorted ascending array.
 * Uses nearest-rank method (deterministic for same input).
 */
const exactPercentile = (sorted: number[], pct: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
};

/** Compute p50/p90/p99 from the current rolling window filtered by options. */
export const computeLatencyPercentiles = (options?: {
  transports?: Set<TransportFamily>;
  endpoints?: Set<EndpointClass>;
}): LatencyPercentiles => {
  prune();
  let filtered = samples;
  if (options?.transports?.size) {
    filtered = filtered.filter((s) => options.transports!.has(s.transport));
  }
  if (options?.endpoints?.size) {
    filtered = filtered.filter((s) => options.endpoints!.has(s.endpoint));
  }
  if (filtered.length === 0) {
    return { p50: 0, p90: 0, p99: 0, sampleCount: 0 };
  }
  const durations = filtered.map((s) => s.durationMs).sort((a, b) => a - b);
  return {
    p50: exactPercentile(durations, 50),
    p90: exactPercentile(durations, 90),
    p99: exactPercentile(durations, 99),
    sampleCount: durations.length,
  };
};

/**
 * Get a snapshot of all current samples in the window, optionally filtered.
 * Returns samples in chronological order.
 */
export const getLatencySamples = (options?: {
  transports?: Set<TransportFamily>;
  endpoints?: Set<EndpointClass>;
}): Readonly<LatencySample[]> => {
  prune();
  let result = samples;
  if (options?.transports?.size) {
    result = result.filter((s) => options.transports!.has(s.transport));
  }
  if (options?.endpoints?.size) {
    result = result.filter((s) => options.endpoints!.has(s.endpoint));
  }
  return result;
};

/** Return a snapshot of all current samples regardless of filters (for export). */
export const getAllLatencySamples = (): Readonly<LatencySample[]> => {
  prune();
  return [...samples];
};
