/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §13 — Health history ring buffer (max 500 entries).

import type { HealthState } from "@/lib/diagnostics/healthModel";

const MAX_ENTRIES = 500;

export type HealthCheckProbeOutcome = "Success" | "Partial" | "Fail" | "Skipped";

export type HealthCheckProbeResult = {
  outcome: HealthCheckProbeOutcome;
  durationMs: number | null;
  reason: string | null;
};

export type HealthHistoryEntry = {
  /** ISO 8601 timestamp */
  timestamp: string;
  overallHealth: HealthState;
  durationMs: number;
  probes: {
    rest: HealthCheckProbeResult;
    jiffy: HealthCheckProbeResult;
    raster: HealthCheckProbeResult;
    config: HealthCheckProbeResult;
    ftp: HealthCheckProbeResult;
  };
  latency: {
    p50: number;
    p90: number;
    p99: number;
  };
};

const ring: HealthHistoryEntry[] = [];

/** Append a new health-check result. Evicts oldest when over capacity. */
export const pushHealthHistoryEntry = (entry: HealthHistoryEntry): void => {
  if (ring.length >= MAX_ENTRIES) {
    ring.shift();
  }
  ring.push(entry);
};

/** Return all entries in chronological order. */
export const getHealthHistory = (): Readonly<HealthHistoryEntry[]> => [...ring];

/** Clear all entries (e.g. on diagnostics clear). */
export const clearHealthHistory = (): void => {
  ring.splice(0);
};

/** Number of entries currently in the buffer. */
export const healthHistorySize = (): number => ring.length;
