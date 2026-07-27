/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * SID Radio Web Worker entry (M0.5 harness spike).
 *
 * The repo had no Web Worker precedent — this proves the vite-worker →
 * Capacitor-WebView path (principle 5, gate G3): it fetches the bundled
 * `.sidcorr`, parses it off the main thread, and posts `{ type: "ready", stats }`
 * with `engineThreadIsMain: false`. All parse/BFS logic lives in importable pure
 * modules; this file only wires them to the worker globals.
 */

import { SIDCORR_BUNDLE_URL } from "./sidcorrRelease";
import { parseSidcorrTiny, type SidcorrTinyBundle } from "./sidcorrTiny";
import {
  computeStationResponse,
  isWorkerGlobalScope,
  readyStatsFromBundle,
  toWorkerErrorMessage,
} from "./sidRadioWorkerCore";
import type { SidRadioMainToWorker } from "./sidRadioWorkerProtocol";

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<SidRadioMainToWorker>) => void) | null;
  __runsInWorker?: boolean;
}

const ctx = self as unknown as WorkerScope;
// §8.6 marker: presence proves the engine module was loaded in a worker.
ctx.__runsInWorker = true;

const fetchBundle = async (provided?: ArrayBuffer): Promise<ArrayBuffer> => {
  if (provided) return provided;
  const response = await fetch(SIDCORR_BUNDLE_URL);
  if (!response.ok) {
    throw new Error(`failed to fetch ${SIDCORR_BUNDLE_URL}: HTTP ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
};

let loadedBundle: SidcorrTinyBundle | null = null;

ctx.onmessage = async (event: MessageEvent<SidRadioMainToWorker>) => {
  const message = event.data;
  try {
    if (message?.type === "load") {
      const buffer = await fetchBundle(message.bundle);
      loadedBundle = parseSidcorrTiny(buffer);
      ctx.postMessage({ type: "ready", stats: readyStatsFromBundle(loadedBundle, !isWorkerGlobalScope()) });
      return;
    }
    if (message?.type === "compute") {
      if (!loadedBundle) {
        ctx.postMessage({ type: "error", id: message.id, code: "not-loaded", message: "bundle not loaded" });
        return;
      }
      ctx.postMessage(computeStationResponse(loadedBundle, message.id, message.request));
      return;
    }
    ctx.postMessage({
      type: "error",
      code: "bad-message",
      message: `unknown worker message: ${String((message as { type?: unknown } | undefined)?.type)}`,
    });
  } catch (error) {
    const errorMessage = toWorkerErrorMessage(error);
    ctx.postMessage(
      message && typeof message === "object" && "id" in message
        ? { ...errorMessage, id: (message as { id?: number }).id }
        : errorMessage,
    );
  }
};
