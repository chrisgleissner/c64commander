/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { EngineSidModel } from "../localSidWorkerProtocol";
import {
  basicRefusal,
  MISSING_BASIC_MESSAGE,
  missingDeclaredBasic,
  type SidRendererCore,
  type SidRendererOpenRequest,
  type SidRendererOpened,
  type SidRendererPrerendered,
  type SidRendererPrerenderSlice,
} from "./sidRendererContract";

/** The slice of `libsidplayfp-wasm`'s `SidAudioEngine` this core drives. */
export interface SidAudioEngineLike {
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

export interface SidAudioEngineCtor {
  new (options: { sampleRate?: number; stereo?: boolean; engine?: "residfp" | "sidlite" }): SidAudioEngineLike;
}

export type SidAudioEngineLoader = () => Promise<SidAudioEngineCtor>;

/**
 * Pre-render slice length and the pause between slices.
 *
 * The pause keeps the pre-render off the tune the listener is hearing: a Pixel 4 renders many
 * times faster than real time, so left to run flat out the pre-render holds a core for the whole
 * tune. It costs the pre-render wall-clock it has to spare, since nobody is waiting for it.
 */
const PRERENDER_SLICE_SECONDS = 5;
const PRERENDER_YIELD_MS = 120;

const wasmEngineName = (engine: SidRendererOpenRequest["engine"]): "residfp" | "sidlite" =>
  engine === "sidlite" ? "sidlite" : "residfp";

const applySystemRoms = (target: SidAudioEngineLike, { roms }: SidRendererOpenRequest): Promise<void> =>
  target.setSystemROMs(
    roms ? new Uint8Array(roms.kernal) : null,
    roms ? new Uint8Array(roms.basic) : null,
    roms?.chargen ? new Uint8Array(roms.chargen) : null,
  );

/**
 * Tell the engine which chip to assume for a tune that does not name one.
 *
 * Only `sidModel` is set. `forceSidModel` is left alone on purpose: libsidplayfp takes the model
 * from the tune's own header, per chip, and consults this value only where the header says
 * `UNKNOWN` or `ANY`. Applied after `loadSidBuffer`, the only order the engine allows, and skipped
 * when the engine already uses that model, since applying it reloads the tune.
 */
const applySidModel = async (target: SidAudioEngineLike, sidModel: EngineSidModel | undefined): Promise<void> => {
  if (!sidModel || !target.setEmulationConfig) return;
  if (target.getEmulationConfig?.()?.sidModel === sidModel) return;
  await target.setEmulationConfig({ sidModel });
};

/**
 * reSIDfp and SIDLite, through `libsidplayfp-wasm`. Runs inside the Web Worker.
 *
 * Without C64 ROM images the engine is still given nulls: `setSystemROMs` accepts them and
 * synthesizes a minimal KERNAL. A declared BASIC program needs a supplied BASIC
 * image; an otherwise accepted tune is not guaranteed to be ROM independent.
 */
export class WasmSidRendererCore implements SidRendererCore {
  private Ctor: SidAudioEngineCtor | null = null;
  private engine: SidAudioEngineLike | null = null;
  private headroomSamples = 0;

  constructor(private readonly loadEngine: SidAudioEngineLoader) {}

  private async ensureModule(): Promise<SidAudioEngineCtor> {
    this.Ctor ??= await this.loadEngine();
    return this.Ctor;
  }

  private disposeEngine(): void {
    // The vendored SidAudioEngine.dispose() swallows its own teardown races; any surprise throw
    // reaches the dispatcher, which reports it.
    this.engine?.dispose();
    this.engine = null;
  }

  private async prepare(target: SidAudioEngineLike, request: SidRendererOpenRequest): Promise<void> {
    if (missingDeclaredBasic(request)) throw new Error(MISSING_BASIC_MESSAGE);
    // ROMs before the tune: the engine reloads the current tune when ROMs change, and the tune is
    // meant to be opened against the real ROMs once.
    await applySystemRoms(target, request);
    await target.loadSidBuffer(new Uint8Array(request.sidBytes), request.songIndex);
    await applySidModel(target, request.sidModel);
  }

  async load(options: { pcmHeadroomSamples?: number }): Promise<void> {
    this.headroomSamples = Math.max(0, Math.floor(options.pcmHeadroomSamples ?? 0));
    await this.ensureModule();
  }

  async open(request: SidRendererOpenRequest): Promise<SidRendererOpened> {
    this.disposeEngine();
    if (missingDeclaredBasic(request)) return basicRefusal(request);
    const startedAt = performance.now();
    const Ctor = await this.ensureModule();
    const moduleReadyAt = performance.now();
    const engine = new Ctor({ sampleRate: request.sampleRate, stereo: true, engine: wasmEngineName(request.engine) });
    this.engine = engine;
    const constructedAt = performance.now();
    await applySystemRoms(engine, request);
    const romsReadyAt = performance.now();
    await engine.loadSidBuffer(new Uint8Array(request.sidBytes), request.songIndex);
    await applySidModel(engine, request.sidModel);
    return {
      sampleRate: engine.getSampleRate(),
      channels: engine.getChannels(),
      tuneInfo: engine.getTuneInfo(),
      openTiming: {
        moduleMs: moduleReadyAt - startedAt,
        constructMs: constructedAt - moduleReadyAt,
        romsMs: romsReadyAt - constructedAt,
        loadMs: performance.now() - romsReadyAt,
      },
    };
  }

  async render(seconds: number) {
    if (!this.engine) return null;
    const startedAt = performance.now();
    const rendered = await this.engine.renderSeconds(seconds);
    const renderMs = performance.now() - startedAt;
    if (!rendered || rendered.length === 0) return null;
    return { pcm: this.withHeadroom(rendered), samples: rendered.length, renderMs };
  }

  /** The chunk in a buffer with free space in front of it, for the native feed's message header. */
  private withHeadroom(pcm: Int16Array): Int16Array {
    if (this.headroomSamples === 0) return pcm;
    const out = new Int16Array(this.headroomSamples + pcm.length);
    out.set(pcm, this.headroomSamples);
    return out.subarray(this.headroomSamples);
  }

  async seek(positionSeconds: number): Promise<number> {
    if (!this.engine) return positionSeconds;
    await this.engine.seekSeconds(positionSeconds);
    return positionSeconds;
  }

  async prerender(
    request: SidRendererOpenRequest & { seconds: number },
    onSlice: (slice: SidRendererPrerenderSlice) => void,
    isSuperseded: () => boolean,
  ): Promise<SidRendererPrerendered> {
    // A SECOND engine: the playing one advances as it renders, so rendering the future on it would
    // fast-forward what the listener is hearing.
    const Ctor = await this.ensureModule();
    const offline = new Ctor({ sampleRate: request.sampleRate, stereo: true, engine: wasmEngineName(request.engine) });
    try {
      await this.prepare(offline, request);
      const sampleRate = offline.getSampleRate();
      const channels = offline.getChannels();
      let done = 0;
      while (done < request.seconds && !isSuperseded()) {
        const want = Math.min(PRERENDER_SLICE_SECONDS, request.seconds - done);
        const pcm = await offline.renderSeconds(want);
        if (!pcm || pcm.length === 0) break;
        done += want;
        onSlice({ pcm, sampleRate, channels, seconds: done });
        if (done < request.seconds) await new Promise((resolve) => setTimeout(resolve, PRERENDER_YIELD_MS));
      }
      return { sampleRate, channels, seconds: done };
    } finally {
      try {
        offline.dispose?.();
      } catch (error) {
        // The result is already out, so this must not become a protocol error; but a dispose that
        // always throws leaks a WASM instance per pre-render, so it has to be visible. No `addLog`
        // in a worker (it writes to localStorage on the main thread), so the console it is.
        console.warn("SID renderer: disposing the offline render context failed", error);
      }
    }
  }

  async close(): Promise<void> {
    this.disposeEngine();
  }

  dispose(): void {
    this.disposeEngine();
  }
}
