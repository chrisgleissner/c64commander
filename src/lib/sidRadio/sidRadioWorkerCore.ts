/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SidcorrParseError, parseSidcorrTiny } from "./sidcorrTiny";
import type { SidRadioErrorMessage, SidRadioReadyStats } from "./sidRadioWorkerProtocol";

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

/** Parse the bundle and derive the ready-stats surfaced to the main thread. */
export const buildReadyStats = (bundle: ArrayBuffer, engineThreadIsMain: boolean): SidRadioReadyStats => {
  const parsed = parseSidcorrTiny(bundle);
  return {
    bundleLoadMs: parsed.stats.bundleLoadMs,
    reverseIndexMs: parsed.stats.reverseIndexMs,
    memoryEstimateBytes: parsed.stats.memoryEstimateBytes,
    fileCount: parsed.fileCount,
    trackCount: parsed.trackCount,
    edgeCount: parsed.stats.edgeCount,
    styleCount: parsed.styles.length,
    engineThreadIsMain,
  };
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
