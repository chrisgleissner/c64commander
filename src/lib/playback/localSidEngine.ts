/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { LocalSidChunkScheduler, type AudioScheduleSink, type AudioScheduleSource } from "./localSidChunkScheduler";
import type { LocalSidMainToWorker, LocalSidWorkerToMain, LocalSidOpenedMessage } from "./localSidWorkerProtocol";

/**
 * Main-thread controller for the Local SID engine (spec §12.2, Track B / LE1).
 * It owns the worker (WASM synth), a Web Audio sink, and the gapless
 * {@link LocalSidChunkScheduler}, and exposes the same "launch this SID"
 * contract `playItem` calls — but the tune plays on **this device**, no C64.
 *
 * Off-main-thread by construction: all libsidplayfp rendering happens in the
 * worker; the main thread only shuttles rendered PCM chunks onto the audio
 * timeline. Prefetch is **clock-driven** — each finished chunk pulls the next
 * from the worker — so there is no polling interval competing with the UI.
 *
 * Both the worker and the audio sink are injected via factories so the whole
 * orchestration (open → prefetch → gapless schedule → position → end) is
 * unit-tested host-deterministically without WASM or real audio.
 */

/** The slice of `Worker` the engine uses (host-injectable). */
export interface LocalSidWorkerLike {
  postMessage(message: LocalSidMainToWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", handler: (event: MessageEvent<LocalSidWorkerToMain>) => void): void;
  terminate(): void;
}

export type LocalSidWorkerFactory = () => LocalSidWorkerLike;

/** An audio sink instance plus its teardown. */
export interface LocalSidAudioSink {
  sink: AudioScheduleSink;
  /** Resume a suspended context (browsers start suspended until a gesture). */
  resume?: () => Promise<void> | void;
  close: () => void;
}

export type LocalSidAudioSinkFactory = (sampleRate: number) => LocalSidAudioSink;

export class LocalSidUnavailableError extends Error {
  constructor(message = "Local SID engine requires Web Workers and Web Audio") {
    super(message);
    this.name = "LocalSidUnavailableError";
  }
}

const defaultWorkerFactory: LocalSidWorkerFactory = () => {
  if (typeof Worker === "undefined") throw new LocalSidUnavailableError();
  // Vite compiles this into a module-worker chunk for both the web build and
  // the Capacitor WebView.
  return new Worker(new URL("./localSid.worker.ts", import.meta.url), { type: "module" });
};

const defaultAudioSinkFactory: LocalSidAudioSinkFactory = (sampleRate: number) => {
  const Ctor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new LocalSidUnavailableError("No AudioContext in this environment");
  const context = new Ctor({ sampleRate });
  const sink: AudioScheduleSink = {
    get currentTime() {
      return context.currentTime;
    },
    get sampleRate() {
      return context.sampleRate;
    },
    createBuffer: (channels, frames, rate) => context.createBuffer(channels, frames, rate),
    createSource: (buffer) => {
      const source = context.createBufferSource();
      source.buffer = buffer as AudioBuffer;
      source.connect(context.destination);
      // AudioBufferSourceNode satisfies the narrow AudioScheduleSource slice we
      // use (start/stop/onended); the DOM onended signature differs only in its
      // (ignored) event arg.
      return source as unknown as AudioScheduleSource;
    },
  };
  return {
    sink,
    resume: () => context.resume(),
    close: () => void context.close(),
  };
};

export interface LocalSidEngineOptions {
  workerFactory?: LocalSidWorkerFactory;
  audioSinkFactory?: LocalSidAudioSinkFactory;
  /** Seconds of audio rendered per chunk (D6 chunked pre-render). */
  chunkSeconds?: number;
  /** Keep this many seconds buffered ahead of the clock. */
  targetBufferSeconds?: number;
  /** Requested output sample rate (engine may override). */
  sampleRate?: number;
}

export interface LocalSidPlayCallbacks {
  /** Playback position in seconds, emitted as chunks are scheduled/drain. */
  onPosition?: (seconds: number) => void;
  /** The tune reached its natural end and all audio drained. */
  onEnded?: () => void;
  /** A fatal engine error during playback. */
  onError?: (error: Error) => void;
}

export interface LocalSidPlayResult {
  /**
   * True when the tune needs C64 ROMs we cannot ship (spec §12.2). Playback is
   * NOT started; the caller (LE2) routes it to "Play on C64" instead.
   */
  romRequired: boolean;
  /** False when `romRequired` — no audio was started. */
  started: boolean;
  sampleRate: number;
  channels: number;
  tuneInfo: Record<string, unknown> | null;
}

export interface LocalSidStats {
  /** Average ms to render one second of audio (≥ 4× realtime ⇒ < 250, §12.6). */
  renderMsPerSec: number;
  /** Worst-case ms/sec seen this session. */
  peakRenderMsPerSec: number;
  /** Audible gaps in the gapless schedule (target 0 over a 3-min PSID). */
  audioUnderruns: number;
  /** Seconds currently buffered ahead of the audio clock. */
  bufferedSeconds: number;
  /** Playback position in seconds. */
  positionSeconds: number;
  /** Chunks scheduled so far. */
  chunksScheduled: number;
}

interface OpenPending {
  resolve: (result: LocalSidPlayResult) => void;
  reject: (error: Error) => void;
}

const DEFAULT_CHUNK_SECONDS = 0.5;
const DEFAULT_TARGET_BUFFER_SECONDS = 1.5;
const DEFAULT_SAMPLE_RATE = 48000;
/** Cap concurrent render requests so a slow device cannot queue unboundedly. */
const MAX_IN_FLIGHT_RENDERS = 2;

export class LocalSidEngine {
  private readonly workerFactory: LocalSidWorkerFactory;
  private readonly audioSinkFactory: LocalSidAudioSinkFactory;
  private readonly chunkSeconds: number;
  private readonly targetBufferSeconds: number;
  private readonly requestedSampleRate: number;

  private worker: LocalSidWorkerLike | null = null;
  private loadPending: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private moduleReady = false;

  private audio: LocalSidAudioSink | null = null;
  private scheduler: LocalSidChunkScheduler | null = null;
  private channels = 2;
  private nextId = 1;
  private activeId = 0;
  private openPending: OpenPending | null = null;
  private callbacks: LocalSidPlayCallbacks = {};

  private inFlightRenders = 0;
  private endReceived = false;
  private endedFired = false;
  private chunksEnded = 0;
  private totalRenderMs = 0;
  private totalRenderedSeconds = 0;
  private peakRenderMsPerSec = 0;

  constructor(options: LocalSidEngineOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.audioSinkFactory = options.audioSinkFactory ?? defaultAudioSinkFactory;
    this.chunkSeconds = options.chunkSeconds ?? DEFAULT_CHUNK_SECONDS;
    this.targetBufferSeconds = options.targetBufferSeconds ?? DEFAULT_TARGET_BUFFER_SECONDS;
    this.requestedSampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  }

  /** True when the engine can run off-main-thread with audio in this environment. */
  static isSupported(): boolean {
    return (
      typeof Worker !== "undefined" &&
      (typeof AudioContext !== "undefined" ||
        typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined")
    );
  }

  private ensureWorker(): LocalSidWorkerLike {
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.addEventListener("message", (event: MessageEvent<LocalSidWorkerToMain>) =>
        this.onMessage(event.data),
      );
    }
    return this.worker;
  }

  /** Instantiate the WASM module in the worker (idempotent). */
  load(): Promise<void> {
    if (this.moduleReady) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let worker: LocalSidWorkerLike;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        reject(error as Error);
        return;
      }
      this.loadPending = { resolve, reject };
      worker.postMessage({ type: "load" });
    });
  }

  /**
   * Open a SID and start playing it on the device. Resolves once the tune's
   * format is known; ROM-dependent tunes resolve with `romRequired` and are NOT
   * started (the caller routes them to the C64).
   */
  async play(
    sidBytes: ArrayBuffer,
    songIndex: number,
    callbacks: LocalSidPlayCallbacks = {},
  ): Promise<LocalSidPlayResult> {
    await this.load();
    this.stopPlayback();
    this.callbacks = callbacks;
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    this.activeId = id;

    return new Promise<LocalSidPlayResult>((resolve, reject) => {
      this.openPending = { resolve, reject };
      // Transfer the SID bytes to the worker (single owner).
      worker.postMessage({ type: "open", id, sidBytes, songIndex, sampleRate: this.requestedSampleRate }, [sidBytes]);
    });
  }

  private onMessage(message: LocalSidWorkerToMain): void {
    switch (message.type) {
      case "ready": {
        this.moduleReady = true;
        const pending = this.loadPending;
        this.loadPending = null;
        pending?.resolve();
        return;
      }
      case "opened":
        this.onOpened(message);
        return;
      case "chunk": {
        if (message.id !== this.activeId) return; // stale tune
        this.inFlightRenders = Math.max(0, this.inFlightRenders - 1);
        this.recordRender(message.renderMs, message.samples);
        this.scheduler?.schedule(message.pcm, this.channels);
        this.emitPosition();
        this.pump();
        return;
      }
      case "end": {
        if (message.id !== this.activeId) return;
        this.inFlightRenders = Math.max(0, this.inFlightRenders - 1);
        this.endReceived = true;
        this.maybeFireEnded();
        return;
      }
      case "error":
        this.onWorkerError(message.code, message.message, message.id);
        return;
    }
  }

  private onOpened(message: LocalSidOpenedMessage): void {
    if (message.id !== this.activeId) return;
    const pending = this.openPending;
    this.openPending = null;
    this.channels = Math.max(1, message.channels);

    if (message.romRequired) {
      // Cannot play ROM-dependent tunes without ship-forbidden C64 ROMs.
      pending?.resolve({
        romRequired: true,
        started: false,
        sampleRate: message.sampleRate,
        channels: message.channels,
        tuneInfo: message.tuneInfo,
      });
      return;
    }

    try {
      this.audio = this.audioSinkFactory(message.sampleRate);
    } catch (error) {
      pending?.reject(error as Error);
      return;
    }
    void this.audio.resume?.();
    this.scheduler = new LocalSidChunkScheduler(this.audio.sink, {
      onSourceEnded: () => this.onSourceEnded(),
    });
    this.pump();

    pending?.resolve({
      romRequired: false,
      started: true,
      sampleRate: message.sampleRate,
      channels: message.channels,
      tuneInfo: message.tuneInfo,
    });
  }

  /** Request renders until the buffer is full ahead of the clock. */
  private pump(): void {
    if (!this.scheduler || this.endReceived || !this.worker) return;
    while (
      this.inFlightRenders < MAX_IN_FLIGHT_RENDERS &&
      this.scheduler.bufferedSeconds() + this.inFlightRenders * this.chunkSeconds < this.targetBufferSeconds
    ) {
      this.inFlightRenders += 1;
      this.worker.postMessage({ type: "render", id: this.activeId, seconds: this.chunkSeconds });
    }
  }

  private onSourceEnded(): void {
    this.chunksEnded += 1;
    this.emitPosition();
    this.pump();
    this.maybeFireEnded();
  }

  private maybeFireEnded(): void {
    if (this.endedFired || !this.endReceived || !this.scheduler) return;
    const scheduled = this.scheduler.getStats().chunksScheduled;
    if (scheduled > 0 && this.chunksEnded >= scheduled) {
      this.endedFired = true;
      this.callbacks.onEnded?.();
    }
  }

  private emitPosition(): void {
    if (!this.scheduler) return;
    this.callbacks.onPosition?.(this.scheduler.positionSeconds());
  }

  private recordRender(renderMs: number, samples: number): void {
    const seconds = samples / Math.max(1, this.channels) / Math.max(1, this.audio?.sink.sampleRate ?? 1);
    if (seconds <= 0) return;
    this.totalRenderMs += renderMs;
    this.totalRenderedSeconds += seconds;
    this.peakRenderMsPerSec = Math.max(this.peakRenderMsPerSec, renderMs / seconds);
  }

  private onWorkerError(code: string, message: string, id?: number): void {
    const error = new Error(`Local SID engine error [${code}]: ${message}`);
    if (this.loadPending) {
      const pending = this.loadPending;
      this.loadPending = null;
      pending.reject(error);
      return;
    }
    if (this.openPending && (id === undefined || id === this.activeId)) {
      const pending = this.openPending;
      this.openPending = null;
      pending.reject(error);
      return;
    }
    this.callbacks.onError?.(error);
  }

  getStats(): LocalSidStats {
    const stats = this.scheduler?.getStats();
    return {
      renderMsPerSec: this.totalRenderedSeconds > 0 ? this.totalRenderMs / this.totalRenderedSeconds : 0,
      peakRenderMsPerSec: this.peakRenderMsPerSec,
      audioUnderruns: stats?.underruns ?? 0,
      bufferedSeconds: stats?.bufferedSeconds ?? 0,
      positionSeconds: this.scheduler?.positionSeconds() ?? 0,
      chunksScheduled: stats?.chunksScheduled ?? 0,
    };
  }

  /** Stop the current tune (keeps the worker + WASM module warm for the next). */
  stop(): void {
    this.stopPlayback();
    this.worker?.postMessage({ type: "close" });
  }

  private stopPlayback(): void {
    this.scheduler?.stopAll();
    this.scheduler = null;
    this.audio?.close();
    this.audio = null;
    this.activeId = 0;
    this.openPending = null;
    this.callbacks = {};
    this.inFlightRenders = 0;
    this.endReceived = false;
    this.endedFired = false;
    this.chunksEnded = 0;
    this.totalRenderMs = 0;
    this.totalRenderedSeconds = 0;
    this.peakRenderMsPerSec = 0;
  }

  /** Tear down the worker + audio entirely (release WASM memory). */
  dispose(): void {
    this.stopPlayback();
    this.worker?.terminate();
    this.worker = null;
    this.moduleReady = false;
    this.loadPending = null;
  }
}
