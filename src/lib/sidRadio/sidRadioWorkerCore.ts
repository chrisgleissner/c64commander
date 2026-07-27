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
  SidRadioStylePopulations,
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

/**
 * Count the members of every style in one pass over `STYLE_MASK_TABLE` — the
 * same table {@link computeStation} admits candidates from, so a tile's count
 * and the station behind it can never disagree.
 *
 * The published manifest carries the same numbers from 0.8.0 onward, but the
 * bundle is the only artefact the app ships, it is authoritative for every
 * release including the ones that predate that field, and the export gate holds
 * the manifest to a recount from exactly this table.
 */
export const stylePopulationsFromBundle = (bundle: SidcorrTinyBundle): SidRadioStylePopulations => {
  const populations: Record<string, number> = {};
  for (const style of bundle.styles) populations[style.key] = 0;
  for (let ordinal = 0; ordinal < bundle.trackCount; ordinal += 1) {
    const mask = bundle.styleMask[ordinal];
    for (const style of bundle.styles) {
      if ((mask & (1 << style.maskBit)) !== 0) populations[style.key] += 1;
    }
  }
  return populations;
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
  stylePopulations: stylePopulationsFromBundle(bundle),
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
