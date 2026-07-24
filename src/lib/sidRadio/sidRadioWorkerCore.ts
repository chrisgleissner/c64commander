/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SidcorrParseError, parseSidcorrTiny, type SidcorrTinyBundle } from "./sidcorrTiny";
import { computeStation } from "./stationEngine";
import type {
  SidRadioCandidatesMessage,
  SidRadioEmptyMessage,
  SidRadioErrorMessage,
  SidRadioReadyStats,
  StationRequest,
} from "./sidRadioWorkerProtocol";

/**
 * Pure worker logic, importable in Node so the message handling is unit-testable
 * without spinning up a real Worker. `sidRadio.worker.ts` is a thin shell that
 * wires these to `self.onmessage` / `fetch`.
 */

/** True when executing inside a Web Worker global scope. */
export const isWorkerGlobalScope = (): boolean => {
  const scope = globalThis as { WorkerGlobalScope?: unknown; self?: unknown };
  return (
    typeof scope.WorkerGlobalScope !== "undefined" &&
    typeof scope.self !== "undefined" &&
    scope.self instanceof (scope.WorkerGlobalScope as new () => unknown)
  );
};

/** Derive the ready-stats surfaced to the main thread from a parsed bundle. */
export const readyStatsFromBundle = (bundle: SidcorrTinyBundle, engineThreadIsMain: boolean): SidRadioReadyStats => ({
  bundleLoadMs: bundle.stats.bundleLoadMs,
  reverseIndexMs: bundle.stats.reverseIndexMs,
  memoryEstimateBytes: bundle.stats.memoryEstimateBytes,
  fileCount: bundle.fileCount,
  trackCount: bundle.trackCount,
  edgeCount: bundle.stats.edgeCount,
  styleCount: bundle.styles.length,
  engineThreadIsMain,
});

/** Parse the bundle and derive the ready-stats surfaced to the main thread. */
export const buildReadyStats = (bundle: ArrayBuffer, engineThreadIsMain: boolean): SidRadioReadyStats =>
  readyStatsFromBundle(parseSidcorrTiny(bundle), engineThreadIsMain);

/** Run the pure engine for a `compute` request and shape the worker→main response. */
export const computeStationResponse = (
  bundle: SidcorrTinyBundle,
  id: number,
  request: StationRequest,
): SidRadioCandidatesMessage | SidRadioEmptyMessage => {
  const result = computeStation({
    bundle,
    seed: request.seed,
    styleFilter: request.styleFilter ?? null,
    likes: request.likes,
    notForMe: request.notForMe,
    shuffleSeed: request.shuffleSeed,
    exclude: request.exclude,
    limit: request.count,
  });
  if (result.candidates.length === 0) {
    return { type: "empty", id, reason: result.empty ?? "exhausted" };
  }
  return { type: "candidates", id, candidates: result.candidates };
};

export const toWorkerErrorMessage = (error: unknown): SidRadioErrorMessage => {
  if (error instanceof SidcorrParseError) {
    return { type: "error", code: error.code, message: error.message };
  }
  return {
    type: "error",
    code: "worker-error",
    message: error instanceof Error ? error.message : String(error),
  };
};
