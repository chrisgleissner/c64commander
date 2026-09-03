/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Reports a failure that was recovered by falling back to a default value.
 *
 * REVIEW.md §7 treats a `catch` that neither logs nor rethrows as a release blocker: a corrupted
 * persisted value is normalised away and the first symptom appears somewhere else entirely, with
 * nothing in the diagnostics log to connect the two. Every such site calls `reportFallback`
 * instead.
 *
 * Code that builds a diagnostics snapshot must not call this: the sink writes to the log the
 * snapshot is collecting. Such a site records the failure in its own output instead - see
 * `networkSnapshot.parseUrl`.
 *
 * This module deliberately imports nothing. `savedDevices/host.ts` is one of its callers, and
 * `logging.ts` reaches `savedDevices/store.ts` through the diagnostics device attribution, so a
 * direct import of the logger from `host.ts` would close an import cycle through a module that
 * reads persisted state while it initialises. `logging.ts` registers the sink instead.
 */

export type FallbackReporter = (site: string, shape: string, context?: Record<string, unknown>) => void;

let reporter: FallbackReporter | null = null;

/** Distinct `site|shape` pairs already reported. Bounded so a hot path cannot grow it without end. */
const reported = new Set<string>();
const REPORTED_KEY_LIMIT = 200;

export const setFallbackReporter = (next: FallbackReporter | null) => {
  reporter = next;
};

/**
 * Describes a value without disclosing it. One caller passes a stored password, so a string is
 * only ever reported by its length. An `Error` is the exception: the caller chose to pass it, and
 * its name and message are the whole of the diagnostic value.
 */
export const describeValueShape = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return `string(length=${value.length})`;
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (typeof value === "object") return `object(keys=${Object.keys(value).length})`;
  return typeof value;
};

/**
 * Records that `site` failed on a value of the given shape and continued with its fallback.
 * Repeats of the same site and shape are dropped so a per-request parse cannot flood the log.
 */
export const reportFallback = (site: string, value: unknown, context?: Record<string, unknown>) => {
  const shape = describeValueShape(value);
  const key = `${site}|${shape}`;
  if (reported.has(key)) return;
  if (reported.size >= REPORTED_KEY_LIMIT) reported.clear();
  reported.add(key);
  reporter?.(site, shape, context);
};

export const resetFallbackReporterForTests = () => {
  reported.clear();
  reporter = null;
};
