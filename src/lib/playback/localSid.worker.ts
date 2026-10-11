/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Web Worker entry for the WASM SID renderers (reSIDfp and SIDLite, from `libsidplayfp-wasm`,
 * GPL-2.0-or-later).
 *
 * Rendering happens here, off the main thread. The WASM glue is loaded lazily by a runtime
 * `import()` of the `public/` copy, so the bundler never parses emscripten output and the module
 * only loads when on-device playback is used. The renderer itself is `WasmSidRendererCore`, and the
 * message handling is the dispatcher every renderer shares; this file only wires them to the worker.
 */

import { createRendererDispatcher } from "./sidRenderer/sidRendererContract";
import { WasmSidRendererCore, type SidAudioEngineCtor } from "./sidRenderer/wasmRendererCore";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "./localSidWorkerProtocol";

/**
 * Absolute path to the loader, served from the app root like the SID Radio bundle.
 * `scripts/sync-libsidplayfp-wasm.mjs` mirrors the package's own layout under `public/`, so
 * `index.js` resolves its `"../dist/libsidplayfp.js"` unchanged and what is served is byte-for-byte
 * what npm delivered.
 */
const LIBSIDPLAYFP_URL = "/wasm/libsidplayfp/dist/index.js";

interface WorkerScope {
  postMessage(message: LocalSidWorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<LocalSidMainToWorker>) => void) | null;
  __runsInWorker?: boolean;
}

const ctx = self as unknown as WorkerScope;
// Presence proves the engine module was loaded in a worker.
ctx.__runsInWorker = true;

const core = new WasmSidRendererCore(async () => {
  const mod = (await import(/* @vite-ignore */ LIBSIDPLAYFP_URL)) as { SidAudioEngine: SidAudioEngineCtor };
  return mod.SidAudioEngine;
});

const dispatch = createRendererDispatcher(core, (message, transfer) => ctx.postMessage(message, transfer ?? []));

ctx.onmessage = (event: MessageEvent<LocalSidMainToWorker>) => {
  void dispatch(event.data);
};
