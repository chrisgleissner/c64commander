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

import { toLocalSidError } from "./localSidWorkerCore";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "./localSidWorkerProtocol";

/** Absolute path to the vendored loader (served from the app root, like the SID Radio bundle). */
const LIBSIDPLAYFP_URL = "/wasm/libsidplayfp/index.js";

/** The slice of the vendored `SidAudioEngine` this worker drives. */
interface SidAudioEngineLike {
  setSystemROMs(kernal: Uint8Array | null, basic: Uint8Array | null, chargen: Uint8Array | null): Promise<void>;
  loadSidBuffer(data: Uint8Array, songIndex?: number): Promise<void>;
  getSampleRate(): number;
  getChannels(): number;
  getTuneInfo(): Record<string, unknown> | null;
  renderSeconds(seconds: number): Promise<Int16Array>;
  dispose(): void;
}
interface SidAudioEngineCtor {
  new (options: { sampleRate?: number; stereo?: boolean; engine?: SidEmulation }): SidAudioEngineLike;
}
interface LibsidplayfpModule {
  SidAudioEngine: SidAudioEngineCtor;
}

type SidEmulation = "residfp" | "sidlite";

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
/**
 * Which emulation to instantiate. reSIDfp and SIDLite are separate WASM
 * artifacts shipped side by side; `SidAudioEngine` resolves the right one from
 * this option, and caches per engine, so the module import itself is shared.
 */
let requestedEmulation: SidEmulation = "residfp";

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

/**
 * Serialises message handling.
 *
 * `SidAudioEngine` is a single stateful WASM instance and `renderSeconds()` is
 * **not** reentrant: it advances the emulated machine from wherever it left
 * off. Handling messages with a bare `async` listener let every `await` yield
 * to the *next* queued message, so with N renders in flight N `renderSeconds()`
 * calls ran concurrently against that one engine — they interleaved and
 * replayed the same span, which is audible as a short passage looping over and
 * over with crackle at the seams. Ordering `open`/`render`/`close` through one
 * chain also stops a render from landing on an engine that is being replaced.
 */
let workQueue: Promise<void> = Promise.resolve();

const handleMessage = async (message: LocalSidMainToWorker): Promise<void> => {
  try {
    switch (message.type) {
      case "load": {
        const startedAt = performance.now();
        if (message.engine) requestedEmulation = message.engine;
        await ensureModule();
        ctx.postMessage({ type: "ready", moduleLoadMs: performance.now() - startedAt });
        return;
      }
      case "open": {
        disposeEngine();
        const bytes = new Uint8Array(message.sidBytes);
        if (!message.roms) {
          // No C64 ROMs available, so nothing can play here.
          //
          // This used to gate only on RSID, on the assumption that PSID tunes
          // are ROM-independent. Measured against real hardware, that is wrong:
          // without KERNAL/BASIC libsidplayfp initialises *any* tune and then
          // never advances it, producing a flat drone (envelope correlation
          // ~0.008 against the machine, vs 0.625 with ROMs — see
          // docs/plans/sid-station/AUDIO-FIDELITY-TEST.md §6.2). Routing to the
          // C64 is the only correct answer.
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
        engine = new Ctor({ sampleRate: message.sampleRate, stereo: true, engine: requestedEmulation });
        // Must precede loadSidBuffer: the engine reloads the current tune when
        // ROMs change, and we want the tune opened against the real ROMs once.
        await engine.setSystemROMs(new Uint8Array(message.roms.kernal), new Uint8Array(message.roms.basic), null);
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

ctx.onmessage = (event: MessageEvent<LocalSidMainToWorker>) => {
  const message = event.data;
  // Never let a rejection break the chain for subsequent messages.
  workQueue = workQueue.then(() => handleMessage(message)).catch(() => undefined);
};
