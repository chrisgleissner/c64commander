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
 * Renders SID tunes to PCM **off the main thread** with the `libsidplayfp-wasm`
 * package's `SidAudioEngine` (GPL-2.0-or-later). The WASM glue is loaded lazily
 * by a runtime `import()` of the `public/` copy — so the bundler never parses
 * emscripten output and the 391 KiB `.wasm` only loads when the user actually
 * selects the "This device" engine. All pure logic lives in the importable,
 * host-tested `localSidWorkerCore.ts`; this file only wires it to the worker
 * globals and the (on-device-validated) engine.
 */

import { toLocalSidError } from "./localSidWorkerCore";
import type { EngineSidModel, LocalSidMainToWorker, LocalSidWorkerToMain } from "./localSidWorkerProtocol";

/**
 * Absolute path to the loader, served from the app root like the SID Radio bundle.
 * `scripts/sync-libsidplayfp-wasm.mjs` mirrors the package's own layout under
 * `public/`, so `index.js` resolves its `"../dist/libsidplayfp.js"` unchanged and
 * what is served is byte-for-byte what npm delivered.
 */
const LIBSIDPLAYFP_URL = "/wasm/libsidplayfp/dist/index.js";

/** The slice of the vendored `SidAudioEngine` this worker drives. */
interface SidAudioEngineLike {
  setSystemROMs(kernal: Uint8Array | null, basic: Uint8Array | null, chargen: Uint8Array | null): Promise<void>;
  loadSidBuffer(data: Uint8Array, songIndex?: number): Promise<void>;
  seekSeconds(seconds: number): Promise<number>;
  getSampleRate(): number;
  getChannels(): number;
  getTuneInfo(): Record<string, unknown> | null;
  renderSeconds(seconds: number): Promise<Int16Array>;
  setEmulationConfig?(config: { sidModel?: EngineSidModel }): Promise<void>;
  getEmulationConfig?(): { sidModel?: string } | null;
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

/**
 * Tell the engine which chip to assume for a tune that does not name one.
 *
 * Only `sidModel` is set. `forceSidModel` is left alone on purpose: libsidplayfp takes the model
 * from the tune's own header, per chip, and consults this value only where the header says
 * `UNKNOWN` or `ANY`. Forcing it would override every tune's declaration — the opposite of what
 * the setting is for.
 *
 * Applied AFTER `loadSidBuffer`, which is the only order the vendored engine allows: its player
 * context does not exist until a tune has been loaded, and `setEmulationConfig` throws without
 * one. Because the call then reloads the tune so the change takes effect from its start, the
 * engine is asked what it is already using first — with the model the engine defaults to, that
 * turns a wasted reload on every open into a synchronous read.
 */
async function applySidModel(target: SidAudioEngineLike, sidModel: EngineSidModel | undefined): Promise<void> {
  if (!sidModel || !target.setEmulationConfig) return;
  if (target.getEmulationConfig?.()?.sidModel === sidModel) return;
  await target.setEmulationConfig({ sidModel });
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
        // No C64 ROM images. This used to refuse the tune outright, and that refusal was the
        // whole of a defect that reached a release: `romFallbackDecision` routes an ordinary tune
        // here and calls it playable, the worker then answered `romRequired: true`, and "Listen on
        // -> Local" produced SILENCE with nothing logged. It is easy to reach — BASIC is read from
        // $A000, which is RAM whenever it is banked out, so a capture taken while a program is
        // running stores KERNAL alone and leaves the set incomplete for good.
        //
        // libsidplayfp does not need the images for a PSID. Measured through this exact call
        // sequence with nulls, on libsidplayfp-wasm 1.0.1: five PSIDs rendered at -11.6 to -17.8
        // dBFS peak, indistinguishable in level from the same tunes with real images. Only RSID
        // genuinely depends on them, and `romFallbackDecision` has already sent those to the C64
        // before anything reaches this worker.
        //
        // So pass what we have. `setSystemROMs` accepts nulls and synthesizes a minimal KERNAL.
        // Opening is the dominant term in `skipToLaunchMs` (§9.2), so its four
        // phases are timed separately — a single total cannot tell a slow WASM
        // instantiation apart from a slow tune load, and those have opposite
        // fixes.
        const openStartedAt = performance.now();
        const Ctor = await ensureModule();
        const moduleReadyAt = performance.now();
        engine = new Ctor({ sampleRate: message.sampleRate, stereo: true, engine: requestedEmulation });
        const engineReadyAt = performance.now();
        // Must precede loadSidBuffer: the engine reloads the current tune when
        // ROMs change, and we want the tune opened against the real ROMs once.
        await engine.setSystemROMs(
          message.roms ? new Uint8Array(message.roms.kernal) : null,
          message.roms ? new Uint8Array(message.roms.basic) : null,
          null,
        );
        const romsReadyAt = performance.now();
        await engine.loadSidBuffer(bytes, message.songIndex);
        await applySidModel(engine, message.sidModel);
        ctx.postMessage({
          type: "opened",
          id: message.id,
          sampleRate: engine.getSampleRate(),
          channels: engine.getChannels(),
          tuneInfo: engine.getTuneInfo(),
          romRequired: false,
          openTiming: {
            moduleMs: moduleReadyAt - openStartedAt,
            constructMs: engineReadyAt - moduleReadyAt,
            romsMs: romsReadyAt - engineReadyAt,
            loadMs: performance.now() - romsReadyAt,
          },
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
      case "seek": {
        if (!engine) {
          // Nothing open: report the request back so the caller's clock stays
          // consistent rather than hanging on a reply that never comes.
          ctx.postMessage({ type: "seeked", id: message.id, positionSeconds: message.positionSeconds });
          return;
        }
        // Serialised behind the same queue as render, so a seek can never
        // interleave with an in-flight renderSeconds() on this one stateful
        // engine — the defect that made playback loop and crackle.
        await engine.seekSeconds(Math.max(0, message.positionSeconds));
        ctx.postMessage({ type: "seeked", id: message.id, positionSeconds: Math.max(0, message.positionSeconds) });
        return;
      }
      case "prerender": {
        // A SECOND engine, deliberately. The playing engine is one stateful WASM
        // instance whose position advances as it renders, so reusing it to
        // render the future would fast-forward what the listener is hearing.
        const Ctor = await ensureModule();
        const bytes = new Uint8Array(message.sidBytes);
        const offline = new Ctor({ sampleRate: message.sampleRate, stereo: true, engine: requestedEmulation });
        try {
          // Nulls when there are no images, for the same reason the `open` branch above takes them:
          // libsidplayfp synthesizes a minimal KERNAL and a PSID renders identically either way.
          // Refusing here meant the pre-render and lead-in caches were empty for anyone whose ROM
          // capture had not succeeded, so every seek re-rendered from the start and every skip
          // opened from cold — silently, because a refused pre-render is not something the listener
          // is told about.
          await offline.setSystemROMs(
            message.roms ? new Uint8Array(message.roms.kernal) : null,
            message.roms ? new Uint8Array(message.roms.basic) : null,
            null,
          );
          await offline.loadSidBuffer(bytes, message.songIndex);
          // Same chip as the playing engine, or the cached render and the live render of one tune
          // would be two different performances with an audible seam between them.
          await applySidModel(offline, message.sidModel);
          const sampleRate = offline.getSampleRate();
          const channels = offline.getChannels();
          // Rendered in slices so progress can be reported and the worker stays
          // responsive to a cancel; one giant renderSeconds() would block it.
          //
          // The pause between slices keeps this off the tune the listener is actually hearing. A
          // Pixel 4 has four cores and this renders many times faster than real time, so left to
          // run flat out it holds a core for the whole tune. It is not the whole story — the
          // dropout this was written for was mostly the main thread's O(n^2) chunk accumulation,
          // fixed in `localSidEngine` — but yielding costs the pre-render wall-clock it has to
          // spare, since nobody is waiting for it.
          const slice = 5;
          const yieldBetweenSlicesMs = 120;
          let done = 0;
          while (done < message.seconds) {
            const want = Math.min(slice, message.seconds - done);
            const pcm = await offline.renderSeconds(want);
            if (!pcm || pcm.length === 0) break;
            done += want;
            // Sent as it is produced rather than held to the end, so the cache grows while the render
            // runs and a seek into what is already rendered is instant. Transferred, not copied.
            ctx.postMessage({ type: "prerender-chunk", id: message.id, pcm, sampleRate, channels, seconds: done }, [
              pcm.buffer,
            ]);
            ctx.postMessage({ type: "prerender-progress", id: message.id, fraction: done / message.seconds });
            if (done < message.seconds) await new Promise((resolve) => setTimeout(resolve, yieldBetweenSlicesMs));
          }
          // No PCM here any more — the slices carried it. This just says the tune is complete, which
          // is what lets the cache stop treating it as a partial.
          ctx.postMessage({ type: "prerendered", id: message.id, sampleRate, channels, seconds: done });
        } catch (error) {
          ctx.postMessage({
            type: "error",
            id: message.id,
            code: "prerender",
            message: (error as Error)?.message ?? String(error),
          });
        } finally {
          try {
            offline.dispose?.();
          } catch (error) {
            // Teardown races are the vendored engine's own problem, and the pre-render result is
            // already sent, so this must not become a protocol error. It must not be invisible
            // either: a dispose that always throws leaks a WASM instance per pre-render. There is
            // no `addLog` inside a worker (it writes to localStorage on the main thread), so this
            // goes to the console, where the WebView inspector and a HIL session can both see it.
            console.warn("Local SID worker: disposing the offline render context failed", error);
          }
        }
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

/**
 * Which tune the queue is working for. Bumped the moment an `open` is *received*, not when it is
 * handled, so anything already queued can be recognised as belonging to the tune being replaced.
 */
let openGeneration = 0;

ctx.onmessage = (event: MessageEvent<LocalSidMainToWorker>) => {
  const message = event.data;
  if (message?.type === "open") openGeneration += 1;
  const generation = openGeneration;
  workQueue = workQueue
    .then(() => {
      // Rendering and seeking for a tune the listener has already left is work nobody will hear:
      // the main thread discards every reply whose id is stale. Doing it anyway is not merely
      // wasted — the queue is strictly ordered, so the new tune's `open` waits behind all of it,
      // and a seek renders and discards everything between here and its target. On a Pixel 4 a
      // scrub-then-skip put enough of that in front of an open to blow its 15 s timeout, and the
      // track change failed with the worker discarded as unresponsive. Skipping costs the caller
      // nothing it was going to use.
      if (generation < openGeneration && (message.type === "render" || message.type === "seek")) {
        // Answer the seek regardless. The reply is free, and a caller waiting on this one rather
        // than a newer seek should not have to wait out its timeout to find that out.
        if (message.type === "seek") {
          ctx.postMessage({
            type: "seeked",
            id: message.id,
            positionSeconds: Math.max(0, message.positionSeconds),
          });
        }
        return undefined;
      }
      return handleMessage(message);
    })
    // Never let a rejection break the chain for subsequent messages. `handleMessage` already
    // catches everything it can and posts a typed error back, so anything arriving here escaped
    // that — which is worth seeing rather than discarding, even though the chain must survive it.
    .catch((error: unknown) => {
      console.warn("Local SID worker: a queued message rejected outside its own handler", error);
    });
};
