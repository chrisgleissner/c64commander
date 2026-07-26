/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { LocalSidChunkScheduler, type AudioScheduleSink, type AudioScheduleSource } from "./localSidChunkScheduler";
import type { LocalSidMainToWorker, LocalSidWorkerToMain, LocalSidOpenedMessage } from "./localSidWorkerProtocol";
import { loadStoredRoms } from "@/lib/roms/romStore";
import { loadSidEmulationEngine, loadPlaybackCrossfadeMs } from "@/lib/config/appSettings";
import { addLog, addErrorLog } from "@/lib/logging";
import { RenderedTuneCache, type RenderedTune } from "./renderedTuneCache";

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
  addEventListener(type: "error", handler: (event: { message?: string }) => void): void;
  addEventListener(type: "messageerror", handler: () => void): void;
  terminate(): void;
}

export type LocalSidWorkerFactory = () => LocalSidWorkerLike;

/** An audio sink instance plus its teardown. */
export interface LocalSidAudioSink {
  sink: AudioScheduleSink;
  /** Resume a suspended context (browsers start suspended until a gesture). */
  resume?: () => Promise<void> | void;
  /** Suspend the audio clock, freezing the schedule where it stands. */
  suspend?: () => Promise<void> | void;
  /** Ramp output down over `ms`, for an opt-in crossfade. */
  fadeOut?: (ms: number) => void;
  /** Ramp output up over `ms`, for an opt-in crossfade. */
  fadeIn?: (ms: number) => void;
  /** Set output level, 0..1. Used by the Play page's volume control. */
  setGain?: (value: number) => void;
  close: () => void;
}

export type LocalSidAudioSinkFactory = (sampleRate: number) => LocalSidAudioSink;

/**
 * The engine that currently owns on-device audio output, if any.
 *
 * Exactly one engine may produce audio at a time. This is enforced rather than
 * assumed because the failure is severe and silent: the controller used to be
 * created per `PlayFilesPage`, and since nothing tore an engine down when its
 * page unmounted, navigating away from Play and back left the previous engine
 * playing. Repeated tab navigation while a tune played produced **eight**
 * concurrent AAudio streams from one process — different tunes layered over
 * each other, with no way for the user to stop them short of killing the app.
 *
 * A shared controller prevents the usual route to that, but a shared instance
 * is a convention a later refactor can quietly undo. This registry is the
 * backstop: whoever opens an audio sink first silences anyone else holding one,
 * so overlap cannot survive even a mistake upstream. The eviction is logged as
 * an error because reaching it at all means an ownership bug exists.
 */
let audioOwner: { stopPlayback: () => void } | null = null;

const claimAudioOwnership = (next: { stopPlayback: () => void }): void => {
  if (audioOwner && audioOwner !== next) {
    addErrorLog("Local SID engine: evicting a second audio owner", {
      service: "local-sid",
      detail:
        "Another engine still held an audio sink when this one started. Playback would have " +
        "overlapped. The previous engine was stopped; this indicates an engine-ownership bug.",
    });
    const previous = audioOwner;
    audioOwner = null;
    previous.stopPlayback();
  }
  audioOwner = next;
};

const releaseAudioOwnership = (engine: { stopPlayback: () => void }): void => {
  if (audioOwner === engine) audioOwner = null;
};

/** Test seam: is on-device audio currently owned by anyone? */
export const __hasLocalSidAudioOwner = (): boolean => audioOwner !== null;

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
  // Everything plays through one gain node so a switchover can fade the whole
  // output, rather than each buffer source having to be faded individually.
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
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
      source.connect(master);
      // AudioBufferSourceNode satisfies the narrow AudioScheduleSource slice we
      // use (start/stop/onended); the DOM onended signature differs only in its
      // (ignored) event arg.
      return source as unknown as AudioScheduleSource;
    },
  };
  return {
    sink,
    resume: () => context.resume(),
    suspend: () => context.suspend(),
    fadeOut: (ms: number) => {
      // Ramp to (near) zero, then let the caller close once the ramp has run.
      // linearRampToValueAtTime needs a starting event to ramp from, hence the
      // explicit setValueAtTime at "now".
      const now = context.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.0001, now + ms / 1000);
      } catch {
        master.gain.value = 0;
      }
    },
    setGain: (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      try {
        master.gain.cancelScheduledValues(context.currentTime);
        // A short ramp rather than a step: an abrupt gain change on a running
        // buffer is an audible click.
        master.gain.setValueAtTime(master.gain.value, context.currentTime);
        master.gain.linearRampToValueAtTime(clamped, context.currentTime + 0.02);
      } catch {
        master.gain.value = clamped;
      }
    },
    fadeIn: (ms: number) => {
      const now = context.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0.0001, now);
        master.gain.linearRampToValueAtTime(1, now + ms / 1000);
      } catch {
        master.gain.value = 1;
      }
    },
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
  /**
   * p99 of the per-chunk render rate — the aggregation the §12.6 budget is
   * pinned on. The running average converges and hides the spikes that
   * actually cause underruns, so the HIL asserts this instead.
   */
  renderMsPerSecP99: number;
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

/**
 * How many per-chunk render rates to keep for the p99. At the 0.5 s default
 * chunk this is ~34 min of audio — longer than any HIL soak, so the p99 covers
 * the whole run while staying a fixed, tiny allocation.
 */
const RENDER_RATE_SAMPLES = 4096;

const DEFAULT_CHUNK_SECONDS = 0.5;
/**
 * How far ahead of the audio clock to keep the schedule.
 *
 * Rendering happens in the worker, but every chunk still crosses the **main
 * thread** to reach Web Audio — so the buffer has to survive whatever the main
 * thread is doing. On a Pixel 4 playing from the HVSC-loaded Play page, that
 * thread stalls for **up to ~1.9 s** (28% of wall time is GC; measured with a
 * long-task observer + CPU profile). At the original 1.5 s this drained the
 * schedule several times a minute — audible gaps, and `audioUnderruns` climbing
 * ~6/min against a pinned budget of 0 (§12.6).
 *
 * 4 s clears the worst observed stall with margin. It costs no extra start
 * latency (the first chunk still starts after `startPaddingSec`; the buffer just
 * builds ahead of it) and ~1.5 MB of audio buffers. The real fix for the stalls
 * is to stop allocating so hard on the Play page, but the audio path should not
 * be hostage to that in the first place.
 */
const DEFAULT_TARGET_BUFFER_SECONDS = 4;
const DEFAULT_SAMPLE_RATE = 48000;
/**
 * Cap concurrent render requests so a slow device cannot queue unboundedly.
 * Must be high enough to actually fill {@link DEFAULT_TARGET_BUFFER_SECONDS}
 * promptly after a stall — at 0.5 s chunks, 4 in flight is 2 s of catch-up.
 */
const MAX_IN_FLIGHT_RENDERS = 4;

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
  /** Bumped per seek so chunks rendered for a superseded position are dropped. */
  private seekEpoch = 0;
  private seekPending: { id: number; resolve: () => void } | null = null;
  private channels = 2;
  private nextId = 1;
  private activeId = 0;
  private openPending: OpenPending | null = null;
  private callbacks: LocalSidPlayCallbacks = {};

  private inFlightRenders = 0;
  private endReceived = false;
  private endedFired = false;
  private chunksEnded = 0;
  /** Fully-rendered tunes (previous/current/next), so a seek is a buffer offset. */
  private readonly renderCache = new RenderedTuneCache();
  private prerenderId = 0;
  private prerenderKey: string | null = null;
  /** Progress of the in-flight pre-render, 0..1; null when none is running. */
  private prerenderFraction: number | null = null;
  private volume = 1;
  private muted = false;
  /** Crossfade length to apply to the tune currently being opened (0 = cut). */
  private pendingCrossfadeMs = 0;
  private totalRenderMs = 0;
  private totalRenderedSeconds = 0;
  private peakRenderMsPerSec = 0;
  /** Per-chunk render rates (ms per rendered second), newest wins once full. */
  private renderRates: number[] = [];

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
      // A worker-side exception or an undeserializable message never reaches
      // `message`; fail the pending load/open (and surface a playback error)
      // instead of hanging until the caller's own timeout.
      this.worker.addEventListener("error", (event) =>
        this.failWorker(`Local SID worker error: ${event.message || "unknown"}`),
      );
      this.worker.addEventListener("messageerror", () =>
        this.failWorker("Local SID worker message could not be deserialized"),
      );
    }
    return this.worker;
  }

  /** Reject the pending load/open and report a playback error on a worker crash. */
  private failWorker(reason: string): void {
    const error = new Error(reason);
    if (this.loadPending) {
      const pending = this.loadPending;
      this.loadPending = null;
      pending.reject(error);
    }
    if (this.openPending) {
      const pending = this.openPending;
      this.openPending = null;
      pending.reject(error);
    }
    this.callbacks.onError?.(error);
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
      // Read at load time, not construction: the worker is torn down between
      // sessions, so a change in Settings takes effect on the next play.
      worker.postMessage({ type: "load", engine: loadSidEmulationEngine() });
    });
  }

  /**
   * Open a SID and start playing it on the device. Resolves once the tune's
   * format is known; a tune that cannot play here resolves with `romRequired`
   * and is NOT started (the caller routes it to the C64).
   */
  async play(
    sidBytes: ArrayBuffer,
    songIndex: number,
    callbacks: LocalSidPlayCallbacks = {},
  ): Promise<LocalSidPlayResult> {
    await this.load();
    // A switchover ALWAYS starts from silence unless the listener has asked for
    // a crossfade. Zero (the default) is a hard cut.
    const crossfadeMs = loadPlaybackCrossfadeMs();
    this.pendingCrossfadeMs = crossfadeMs;
    this.stopPlayback({ crossfadeMs });
    this.callbacks = callbacks;
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;
    this.activeId = id;

    // Read per-play rather than cached, so revoking the ROMs in Settings takes
    // effect on the very next track instead of after a restart.
    const roms = loadStoredRoms();
    const transfer: Transferable[] = [sidBytes];
    let romPayload: { kernal: ArrayBuffer; basic: ArrayBuffer } | undefined;
    if (roms.kernal && roms.basic) {
      // Copy: the stored Uint8Arrays are reused across plays, so their buffers
      // must not be detached by the transfer.
      const kernal = roms.kernal.slice().buffer;
      const basic = roms.basic.slice().buffer;
      romPayload = { kernal, basic };
      transfer.push(kernal, basic);
    }

    return new Promise<LocalSidPlayResult>((resolve, reject) => {
      this.openPending = { resolve, reject };
      // Transfer the SID bytes to the worker (single owner).
      worker.postMessage(
        { type: "open", id, sidBytes, songIndex, sampleRate: this.requestedSampleRate, roms: romPayload },
        transfer,
      );
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
      case "prerender-progress":
        if (message.id === this.prerenderId) this.prerenderFraction = message.fraction;
        return;
      case "prerendered": {
        if (message.id !== this.prerenderId || !this.prerenderKey) return;
        this.prerenderFraction = null;
        this.renderCache.set(this.prerenderKey, {
          pcm: message.pcm,
          sampleRate: message.sampleRate,
          channels: message.channels,
          durationSeconds: message.seconds,
        });
        addLog("debug", "Local SID tune pre-rendered", {
          service: "local-sid",
          key: this.prerenderKey,
          seconds: Math.round(message.seconds),
          megabytes: +(message.pcm.byteLength / 1024 / 1024).toFixed(1),
          cachedTunes: this.renderCache.size,
          cacheMegabytes: +(this.renderCache.bytes / 1024 / 1024).toFixed(1),
        });
        return;
      }
      case "chunk": {
        if (message.id !== this.activeId) return; // stale tune
        // The worker handles messages in order, so anything still arriving
        // before the "seeked" reply was rendered for the position we just left.
        // Scheduling it would play the wrong part of the tune.
        if (this.seekPending) return;
        this.inFlightRenders = Math.max(0, this.inFlightRenders - 1);
        this.recordRender(message.renderMs, message.samples);
        this.scheduler?.schedule(message.pcm, this.channels);
        this.emitPosition();
        this.pump();
        return;
      }
      case "end": {
        if (message.id !== this.activeId) return;
        // Same reasoning as "chunk": an end raised before the seek completed
        // describes the old position and must not finish the tune.
        if (this.seekPending) return;
        this.inFlightRenders = Math.max(0, this.inFlightRenders - 1);
        this.endReceived = true;
        this.maybeFireEnded();
        return;
      }
      case "seeked": {
        if (this.seekPending?.id !== message.id) return;
        const pending = this.seekPending;
        this.seekPending = null;
        pending.resolve();
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

    if (message.openTiming) {
      // Opening dominates `skipToLaunchMs`; log the split so a slow skip can be
      // attributed instead of guessed at.
      addLog("debug", "Local SID engine opened", {
        service: "local-sid",
        ...message.openTiming,
        totalMs:
          message.openTiming.moduleMs +
          message.openTiming.constructMs +
          message.openTiming.romsMs +
          message.openTiming.loadMs,
      });
    }

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

    // HARD INVARIANT: at most one engine may hold an open audio sink.
    //
    // Overlapping tunes is a showstopper in the field, so this is enforced here
    // -- at the one place audio is actually created -- rather than relying on
    // callers to be well behaved. Any engine that still holds a sink is silenced
    // before this one opens its own, whatever created it and however the UI got
    // there. See claimAudioOwnership.
    claimAudioOwnership(this);
    try {
      this.audio = this.audioSinkFactory(message.sampleRate);
    } catch (error) {
      releaseAudioOwnership(this);
      pending?.reject(error as Error);
      return;
    }
    void this.audio.resume?.();
    // Carry the listener's level onto the new tune's sink.
    if (this.volume !== 1 || this.muted) this.audio.setGain?.(this.muted ? 0 : this.volume);
    if (this.pendingCrossfadeMs > 0) this.audio.fadeIn?.(this.pendingCrossfadeMs);
    this.pendingCrossfadeMs = 0;
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

  /**
   * Jump to an absolute position in the open tune.
   *
   * Order matters. The queued audio belongs to the old position, so it is
   * dropped first; `seekEpoch` then invalidates any render already in flight in
   * the worker, because those chunks would otherwise be scheduled after the seek
   * and play the wrong part of the tune. Only once the worker confirms the seek
   * does prefetching resume.
   */
  async seekTo(positionSeconds: number): Promise<void> {
    if (!this.worker || !this.scheduler) return;
    const target = Math.max(0, positionSeconds);
    const id = this.nextId;
    this.nextId += 1;

    this.seekEpoch += 1;
    const epoch = this.seekEpoch;
    this.inFlightRenders = 0;
    this.endReceived = false;
    this.endedFired = false;
    this.chunksEnded = 0;
    this.scheduler.resetTo(target);
    this.emitPosition();

    await new Promise<void>((resolve) => {
      this.seekPending = { id, resolve };
      this.worker?.postMessage({ type: "seek", id, positionSeconds: target });
    });

    // A newer seek landed while this one was in flight; that one owns the state.
    if (epoch !== this.seekEpoch) return;
    this.pump();
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
    const rate = renderMs / seconds;
    this.totalRenderMs += renderMs;
    this.totalRenderedSeconds += seconds;
    this.peakRenderMsPerSec = Math.max(this.peakRenderMsPerSec, rate);
    if (this.renderRates.length >= RENDER_RATE_SAMPLES) this.renderRates.shift();
    this.renderRates.push(rate);
  }

  /** p99 of the recorded per-chunk render rates (0 before the first chunk). */
  private renderRateP99(): number {
    if (this.renderRates.length === 0) return 0;
    const sorted = [...this.renderRates].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
    return sorted[Math.max(0, index)];
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
      renderMsPerSecP99: this.renderRateP99(),
      peakRenderMsPerSec: this.peakRenderMsPerSec,
      audioUnderruns: stats?.underruns ?? 0,
      bufferedSeconds: stats?.bufferedSeconds ?? 0,
      positionSeconds: this.scheduler?.positionSeconds() ?? 0,
      chunksScheduled: stats?.chunksScheduled ?? 0,
    };
  }

  /**
   * Pause on-device playback. Suspending the AudioContext freezes its clock, so
   * everything already scheduled holds its place and `resume()` continues from
   * exactly there — no re-render, no drift. Safe to call when not playing.
   */
  async pause(): Promise<void> {
    await this.audio?.suspend?.();
  }

  /** Resume after {@link pause}. */
  async resume(): Promise<void> {
    await this.audio?.resume?.();
  }

  /** True while an on-device tune is loaded and scheduled. */
  isActive(): boolean {
    return this.scheduler !== null;
  }

  /** Stop the current tune (keeps the worker + WASM module warm for the next). */
  /**
   * Output level for on-device playback, 0..1.
   *
   * The Play page's volume control used to reach only the C64's Audio Mixer, so
   * it did nothing at all while the tune was rendering here — the slider moved
   * and the sound did not. Remembered across tunes so a new track opens at the
   * level the listener chose.
   */
  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    this.audio?.setGain?.(this.muted ? 0 : this.volume);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.audio?.setGain?.(muted ? 0 : this.volume);
  }

  /** A fully-rendered tune, when this one has been cached. */
  getRenderedTune(key: string): RenderedTune | null {
    return this.renderCache.get(key);
  }

  /** 0..1 while a pre-render is running, else null. */
  getPrerenderProgress(): number | null {
    return this.prerenderFraction;
  }

  /**
   * Render the whole tune in the background so seeking inside it is instant.
   *
   * Rendering costs roughly 150 ms of CPU per second of audio on a Pixel 4, so
   * a three-minute tune is ~27 s of work — worth paying once, off to the side,
   * rather than paying part of it again on every backward seek.
   */
  prerender(key: string, sidBytes: ArrayBuffer, songIndex: number, seconds: number): void {
    if (this.renderCache.has(key) || !this.worker || seconds <= 0) return;
    const roms = loadStoredRoms();
    if (!roms.kernal || !roms.basic) return;
    this.prerenderId += 1;
    this.prerenderKey = key;
    this.prerenderFraction = 0;
    const kernal = roms.kernal.slice().buffer;
    const basic = roms.basic.slice().buffer;
    this.worker.postMessage(
      {
        type: "prerender",
        id: this.prerenderId,
        sidBytes,
        songIndex,
        sampleRate: this.requestedSampleRate,
        seconds,
        roms: { kernal, basic },
      },
      [sidBytes, kernal, basic],
    );
  }

  stop(): void {
    this.stopPlayback();
    this.worker?.postMessage({ type: "close" });
  }

  /**
   * Silence and tear down this engine's audio. Not private: the audio-ownership
   * registry calls it to evict a stale owner (see claimAudioOwnership).
   */
  stopPlayback(options: { crossfadeMs?: number } = {}): void {
    releaseAudioOwnership(this);
    const fadeMs = options.crossfadeMs ?? 0;
    const outgoing = this.audio;
    this.scheduler?.stopAll(fadeMs > 0 ? { keepSourcesFor: fadeMs } : undefined);
    this.scheduler = null;
    this.audio = null;
    if (outgoing && fadeMs > 0 && outgoing.fadeOut) {
      // Deliberate crossfade: let the tail ring out under the incoming tune, then
      // close. The context is detached from this engine already, so nothing can
      // schedule onto it and it cannot become a second live source.
      outgoing.fadeOut(fadeMs);
      setTimeout(() => outgoing.close(), fadeMs + 50);
    } else {
      outgoing?.close();
    }
    this.activeId = 0;
    this.openPending = null;
    this.callbacks = {};
    this.inFlightRenders = 0;
    this.endReceived = false;
    this.endedFired = false;
    this.chunksEnded = 0;
    // Render throughput is deliberately NOT reset here: it measures what this
    // device sustains across the whole engine session, so a multi-track soak
    // (§12.6) reports one p99 over every tune rather than only the last one.
  }

  /** Tear down the worker + audio entirely (release WASM memory). */
  dispose(): void {
    this.stopPlayback();
    this.worker?.terminate();
    this.worker = null;
    this.moduleReady = false;
    this.loadPending = null;
    this.totalRenderMs = 0;
    this.totalRenderedSeconds = 0;
    this.peakRenderMsPerSec = 0;
    this.renderRates = [];
  }
}
