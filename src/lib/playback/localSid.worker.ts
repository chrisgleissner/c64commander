/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Local SID engine Web Worker entry (spec §12.2, Track B / LE1).
 *
 * Renders SID tunes to PCM **off the main thread** with the vendored
 * `@sidflow/libsidplayfp-wasm` `SidAudioEngine` (GPL-2.0-or-later; see
 * `public/wasm/libsidplayfp/VENDORING.md`). The WASM glue is loaded lazily by a
 * runtime `import()` of the verbatim-copied `public/` asset — so the bundler
 * never parses emscripten output and the 391 KiB `.wasm` only loads when the
 * user actually selects the "This device" engine. All pure logic lives in the
 * importable, host-tested `localSidWorkerCore.ts`; this file only wires it to
 * the worker globals and the (on-device-validated) engine.
 */

import { detectRomRequired, toLocalSidError } from "./localSidWorkerCore";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "./localSidWorkerProtocol";

/** Absolute path to the vendored loader (served from the app root, like the SID Radio bundle). */
const LIBSIDPLAYFP_URL = "/wasm/libsidplayfp/index.js";

/** The slice of the vendored `SidAudioEngine` this worker drives. */
interface SidAudioEngineLike {
  loadSidBuffer(data: Uint8Array, songIndex?: number): Promise<void>;
  getSampleRate(): number;
  getChannels(): number;
  getTuneInfo(): Record<string, unknown> | null;
  renderSeconds(seconds: number): Promise<Int16Array>;
  dispose(): void;
}
interface SidAudioEngineCtor {
  new (options: { sampleRate?: number; stereo?: boolean }): SidAudioEngineLike;
}
interface LibsidplayfpModule {
  SidAudioEngine: SidAudioEngineCtor;
}

interface WorkerScope {
  postMessage(message: LocalSidWorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<LocalSidMainToWorker>) => void) | null;
  __runsInWorker?: boolean;
}

const ctx = self as unknown as WorkerScope;
// §8.6 marker: presence proves the engine module was loaded in a worker.
ctx.__runsInWorker = true;

let EngineCtor: SidAudioEngineCtor | null = null;
let engine: SidAudioEngineLike | null = null;

async function ensureModule(): Promise<SidAudioEngineCtor> {
  if (EngineCtor) return EngineCtor;
  const mod = (await import(/* @vite-ignore */ LIBSIDPLAYFP_URL)) as LibsidplayfpModule;
  EngineCtor = mod.SidAudioEngine;
  return EngineCtor;
}

function disposeEngine(): void {
  // The vendored SidAudioEngine.dispose() swallows its own teardown races; any
  // surprise throw is caught by the onmessage handler and reported.
  engine?.dispose();
  engine = null;
}

ctx.onmessage = async (event: MessageEvent<LocalSidMainToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "load": {
        const startedAt = performance.now();
        await ensureModule();
        ctx.postMessage({ type: "ready", moduleLoadMs: performance.now() - startedAt });
        return;
      }
      case "open": {
        disposeEngine();
        const bytes = new Uint8Array(message.sidBytes);
        if (detectRomRequired(bytes)) {
          // ROM-dependent (RSID) — do not instantiate the engine; route to C64.
          ctx.postMessage({
            type: "opened",
            id: message.id,
            sampleRate: message.sampleRate,
            channels: 2,
            tuneInfo: null,
            romRequired: true,
          });
          return;
        }
        const Ctor = await ensureModule();
        engine = new Ctor({ sampleRate: message.sampleRate, stereo: true });
        await engine.loadSidBuffer(bytes, message.songIndex);
        ctx.postMessage({
          type: "opened",
          id: message.id,
          sampleRate: engine.getSampleRate(),
          channels: engine.getChannels(),
          tuneInfo: engine.getTuneInfo(),
          romRequired: false,
        });
        return;
      }
      case "render": {
        if (!engine) {
          ctx.postMessage({ type: "end", id: message.id });
          return;
        }
        const startedAt = performance.now();
        const pcm = await engine.renderSeconds(message.seconds);
        const renderMs = performance.now() - startedAt;
        if (!pcm || pcm.length === 0) {
          ctx.postMessage({ type: "end", id: message.id });
          return;
        }
        ctx.postMessage({ type: "chunk", id: message.id, pcm, samples: pcm.length, renderMs }, [pcm.buffer]);
        return;
      }
      case "close": {
        disposeEngine();
        return;
      }
    }
  } catch (error) {
    const code = message?.type === "load" ? "load" : message?.type === "render" ? "render" : "open";
    const id = message && "id" in message ? (message as { id?: number }).id : undefined;
    ctx.postMessage(toLocalSidError(error, code, id));
  }
};
