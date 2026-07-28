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
import { claimPhoneAudio, phoneAudioOwner, releasePhoneAudio } from "@/lib/audio/phoneAudioOwnership";
import { notifyPlaybackActivityChanged } from "./playbackActivitySignal";
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
  /**
   * Ramp output up over `ms`, for an opt-in crossfade.
   *
   * `toGain` is where the ramp ENDS. It is not optional in practice: ramping to
   * a hardcoded 1 wiped whatever level the listener had chosen, so the volume
   * control worked until the next crossfade and then jumped back to full.
   */
  fadeIn?: (ms: number, toGain?: number) => void;
  /** Set output level, 0..1. Used by the Play page's volume control. */
  setGain?: (value: number) => void;
  close: () => void;
}

export type LocalSidAudioSinkFactory = (sampleRate: number) => LocalSidAudioSink;

/**
 * How long to wait for the worker to answer a module load or a tune open.
 *
 * Neither wait used to be bounded, and an unanswered one does far more than lose a track. The
 * caller chain is `playStart` → `playItem` → here, and `playStart` holds a single-flight guard and
 * `isPlaylistLoading` across the whole thing, releasing both in a `finally`. An await that never
 * settles means that `finally` never runs: the guard stays acquired so every later play returns at
 * it, and `isPlaylistLoading` stays true so `canTransport` is false — Play and Pause both go
 * disabled and selecting another track does nothing. One unanswered message disables playback for
 * the rest of the session, silently, with no error raised anywhere.
 *
 * Reproduced on a Pixel 4 against a c64u, on **rc4 as shipped** as well as with the scrub fixes:
 * five back-to-back hold-to-seek gestures on one tune, then Stop/Play, and the transport is dead
 * until the app is relaunched.
 *
 * Generous next to what these actually cost — an open measures 23-48 ms on that device — so this
 * only ever fires when the worker has genuinely stopped answering. Rejecting then routes into the
 * caller's existing PLAYBACK_START error path, which reports the failure and leaves the transport
 * usable. Matches the 15 s the SID Radio worker client already applies to its own load.
 */
const WORKER_REPLY_TIMEOUT_MS = 15000;

/**
 * Liveness watchdog for on-device playback.
 *
 * The render loop is self-sustaining and has no other end: `pump()` asks the worker for a chunk,
 * the chunk is scheduled, and the chunk finishing pumps the next one. Nothing supervises it. If the
 * worker stops answering `render`, `inFlightRenders` stays pinned at its cap, no chunk ever
 * arrives, the scheduler drains and the tune goes silent — with `endReceived` still false, so
 * `maybeFireEnded` never fires either. The engine sits there, `isActive()` true, producing nothing,
 * while the Play page's clock (a wall clock, independent of the engine) counts merrily on. The user
 * sees a playing track and hears silence, until the songlength runs out and the playlist advances.
 *
 * Measured on a Pixel 4 against a c64u: after a burst of hold-to-seek gestures the scrubbed tune
 * went silent for the rest of its duration — `dumpsys audio` showing no started player at all —
 * and only the next track brought the sound back.
 *
 * So: while a tune should be producing audio, check that it is, and put it right if it is not.
 */
const WATCHDOG_TICK_MS = 1000;

/**
 * How long the engine may go without scheduling any audio, while it should be playing and its
 * buffer is empty, before that counts as a stall. Comfortably longer than a chunk (the engine
 * renders in `chunkSeconds` slices and keeps `targetBufferSeconds` queued ahead) so ordinary
 * scheduling jitter, a slow render or a device under load can never trip it.
 */
const AUDIO_STALL_TIMEOUT_MS = 5000;

/**
 * Buffered audio below this counts as starved. Not zero: the scheduler reports what is queued
 * *ahead of the audio clock*, which dips fractionally between chunks even when perfectly healthy.
 */
const STARVED_BUFFER_SECONDS = 0.05;

/**
 * Ownership of this device's speaker now lives in `@/lib/audio/phoneAudioOwnership`,
 * shared with the A/V mirror.
 *
 * It used to be a registry private to this file, guarding engines against each
 * other. That was the right idea aimed one level too low: the failure it was
 * built for was severe and silent (a per-page controller left engines playing
 * after their page unmounted — repeated tab navigation produced **eight**
 * concurrent AAudio streams of different tunes), but the mirror could still
 * play the C64's audio straight over the top of a local tune, because the two
 * subsystems had no common notion of who holds the speaker. Now they do.
 */
const claimAudioOwnership = (engine: { stopPlayback: () => void }): void => {
  claimPhoneAudio("local-sid", engine, () => engine.stopPlayback());
};

const releaseAudioOwnership = (engine: object): void => {
  releasePhoneAudio(engine);
};

/** Test seam: is on-device audio currently owned by anyone? */
export const __hasLocalSidAudioOwner = (): boolean => phoneAudioOwner() !== null;

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
    fadeIn: (ms: number, toGain = 1) => {
      const now = context.currentTime;
      const target = Math.min(1, Math.max(0.0001, toGain));
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0.0001, now);
        master.gain.linearRampToValueAtTime(target, now + ms / 1000);
      } catch {
        master.gain.value = target;
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
  /**
   * The engine has given up on this tune and no further audio is coming.
   *
   * Distinct from {@link onEnded}, which means the tune finished normally. This fires when a stall
   * could not be repaired, so the caller can move on rather than leave a track that will produce
   * nothing for the rest of its length.
   */
  onUnrecoverable?: () => void;
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
  /** Shared in-flight module load, so overlapping callers cannot displace each other's resolver. */
  private loadInFlight: Promise<void> | null = null;
  private moduleReady = false;

  private audio: LocalSidAudioSink | null = null;
  private scheduler: LocalSidChunkScheduler | null = null;
  /** Liveness watchdog state (see WATCHDOG_TICK_MS). */
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** When audio was last actually scheduled — the one signal that the pipeline is alive. */
  private lastAudioAtMs = 0;
  /** Paused explicitly, as opposed to starved: a suspended clock must never read as a stall. */
  private paused = false;
  /** One recovery per tune; a second stall is left to the playlist's own advance. */
  private stallRecoveryUsed = false;
  private stallRecoveryInFlight = false;
  /** Kept so a stalled tune can be re-opened where it stopped; the played bytes are transferred away. */
  private currentTune: { bytes: ArrayBuffer; songIndex: number } | null = null;
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
  /**
   * The pre-render's own worker — a separate thread from playback, because
   * sharing one starved playback into silence (see `ensurePrerenderWorker`).
   */
  private prerenderWorker: LocalSidWorkerLike | null = null;
  /** Progress of the in-flight pre-render, 0..1; null when none is running. */
  private prerenderFraction: number | null = null;
  /**
   * The fully-rendered tune currently being played FROM, and the read cursor
   * into it. Set only by a seek that the cache could satisfy: adopting the
   * cache mid-playback would splice a separately-rendered copy into audio that
   * is already sounding, and the two renders need not be sample-identical.
   */
  private cached: RenderedTune | null = null;
  private cachedCursor = 0;
  /** Key of the tune currently open, so a finished pre-render can be matched to it. */
  private currentKey: string | null = null;
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

  /**
   * Throw away a worker that missed its reply window, so the next play starts from a fresh one.
   *
   * Timing out the wait is what stops the UI wedging, but on its own it leaves the same
   * unresponsive worker in place — the transport comes back and then every retry spends another
   * 15 s failing against it. `ensureWorker` builds a new worker whenever this is null, so dropping
   * it here is the whole recovery: the next play reloads the module and opens the tune normally.
   * A worker that has stopped answering is not worth keeping.
   */
  private discardWorker(reason: string): void {
    addLog("warn", "Local SID engine: discarding an unresponsive worker", { service: "local-sid", reason });
    this.worker?.terminate();
    this.worker = null;
    this.moduleReady = false;
    this.loadPending = null;
    this.loadInFlight = null;
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

  /**
   * The pre-render gets its OWN worker, i.e. its own thread.
   *
   * It used to share the playback worker. Rendering is CPU-bound — roughly
   * 150 ms per second of audio — so a pre-render occupied that single thread
   * almost continuously and the playback renders behind it never ran: measured
   * on a Pixel 4, every locally-played tune was SILENT for its first ~35 s
   * (audio stream open, clock advancing, room floor at the microphone), and the
   * same passage played normally once the pre-render finished. Slicing the
   * render and awaiting between slices was not enough; a slice is ~750 ms of
   * solid WASM and one thread cannot serve both.
   *
   * Separate workers are separate threads, and a phone has cores to spare.
   */
  private ensurePrerenderWorker(): LocalSidWorkerLike {
    if (!this.prerenderWorker) {
      this.prerenderWorker = this.workerFactory();
      // Routed into the same handler: pre-render replies are matched on
      // `prerenderId`, which is independent of the playback ids.
      this.prerenderWorker.addEventListener("message", (event: MessageEvent<LocalSidWorkerToMain>) =>
        this.onMessage(event.data),
      );
      // A pre-render that dies must not fail playback — the tune is still
      // playing, seeks simply go back to the slow path. So this deliberately
      // does NOT call failWorker. It is still logged: a thread that keeps dying
      // leaves every seek on the slow path, which is exactly the kind of quiet
      // regression that hides for months.
      this.prerenderWorker.addEventListener("error", (event) =>
        this.onPrerenderWorkerFailure(event.message || "unknown worker error"),
      );
      this.prerenderWorker.addEventListener("messageerror", () =>
        this.onPrerenderWorkerFailure("a pre-render message could not be deserialized"),
      );
    }
    return this.prerenderWorker;
  }

  /** Report a dead pre-render thread, then give up on it. Playback is untouched. */
  private onPrerenderWorkerFailure(reason: string): void {
    addErrorLog("Local SID pre-render thread failed; seeking falls back to re-rendering", {
      service: "local-sid",
      error: reason,
    });
    this.abandonPrerender();
  }

  /** Give up on the current pre-render, leaving playback untouched. */
  private abandonPrerender(): void {
    this.prerenderFraction = null;
    this.prerenderKey = null;
    this.prerenderWorker?.terminate();
    this.prerenderWorker = null;
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

  /**
   * Instantiate the WASM module in the worker.
   *
   * Idempotent for overlapping callers too, not just repeat ones. Two tracks
   * starting close together both `await load()` before they open anything, and
   * `loadPending` is a single slot the `ready` handler resolves without matching
   * an id — so a second call used to drop the first's resolver and leave that
   * `play()` waiting forever, as well as posting a redundant WASM init. Sharing
   * one in-flight load fixes both.
   */
  load(): Promise<void> {
    if (this.moduleReady) return Promise.resolve();
    if (this.loadInFlight) return this.loadInFlight;
    // One promise, not a chained `.catch` — the memo must settle on exactly the
    // tick the worker's `ready` does. `play()` awaits this before it registers
    // its open, so an extra link here delays every open by a microtask.
    this.loadInFlight = new Promise<void>((resolve, reject) => {
      let worker: LocalSidWorkerLike;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        // A failed load is not retained, so a caller can retry.
        this.loadInFlight = null;
        reject(error as Error);
        return;
      }
      const timer = setTimeout(() => {
        this.discardWorker("module load timed out");
        reject(new Error(`Local SID engine did not load within ${WORKER_REPLY_TIMEOUT_MS}ms`));
      }, WORKER_REPLY_TIMEOUT_MS);
      this.loadPending = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          this.loadInFlight = null;
          reject(error);
        },
      };
      // Read at load time, not construction: the worker is torn down between
      // sessions, so a change in Settings takes effect on the next play.
      worker.postMessage({ type: "load", engine: loadSidEmulationEngine() });
    });
    return this.loadInFlight;
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
    // Copied before the transfer detaches it: the watchdog re-opens this tune if it ever stalls,
    // and by then the buffer the caller handed us belongs to the worker.
    this.currentTune = { bytes: sidBytes.slice(0), songIndex };
    this.stallRecoveryUsed = false;
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
      const timer = setTimeout(() => {
        this.openPending = null;
        this.discardWorker("tune open timed out");
        reject(new Error(`Local SID engine did not open the tune within ${WORKER_REPLY_TIMEOUT_MS}ms`));
      }, WORKER_REPLY_TIMEOUT_MS);
      const settle = <A extends unknown[], R>(fn: (...args: A) => R) => {
        return (...args: A): R => {
          clearTimeout(timer);
          return fn(...args);
        };
      };
      this.openPending = { resolve: settle(resolve), reject: settle(reject) };
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
    const level = this.muted ? 0 : this.volume;
    if (this.volume !== 1 || this.muted) this.audio.setGain?.(level);
    // Fade UP TO the listener's level. `fadeIn` cancels whatever `setGain` just
    // scheduled, so a fade to a hardcoded 1 would undo the line above and the
    // volume control would silently reset on every crossfade.
    if (this.pendingCrossfadeMs > 0) this.audio.fadeIn?.(this.pendingCrossfadeMs, level);
    this.pendingCrossfadeMs = 0;
    this.scheduler = new LocalSidChunkScheduler(this.audio.sink, {
      onSourceEnded: () => this.onSourceEnded(),
    });
    // Supervise from the moment there is something to supervise. The clock starts here rather than
    // at the first chunk, so a tune that never produces one at all is caught too.
    this.startWatchdog();
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

    // If this tune has been rendered in full, the seek is a buffer offset and
    // needs no engine round-trip at all. That is the whole point of the
    // pre-render: libsidplayfp cannot rewind, so asking the engine to go
    // backwards costs ~150 ms of CPU per second of audio it has to replay —
    // seconds of silence for a seek the listener expects to be instant.
    const rendered = this.currentKey ? this.renderCache.get(this.currentKey) : null;
    if (rendered) {
      this.cached = rendered;
      this.cachedCursor = Math.min(rendered.pcm.length, Math.floor(target * rendered.sampleRate) * rendered.channels);
      addLog("debug", "Local SID seek served from the pre-render cache", {
        service: "local-sid",
        seconds: target,
      });
      this.pump();
      return;
    }

    await new Promise<void>((resolve) => {
      // Hand the slot over rather than overwrite it. There is exactly one
      // `seekPending`, and the `seeked` handler only resolves a reply whose id
      // still matches it — so replacing an outstanding entry drops its resolver
      // and that caller's await never settles. A scrub makes overlapping seeks
      // the norm, not a corner case: hold-to-seek posts one every 350 ms and the
      // release posts another.
      //
      // Worse than a stuck await: `seekPending` also gates "chunk" and "end", so
      // while it is set every rendered chunk is discarded. A leaked entry
      // therefore silences playback for good — on a Pixel 4 that read as the
      // clock frozen mid-tune with no audio track left and the transport still
      // claiming to play. The superseded seek is simply over; resolve it.
      this.seekPending?.resolve();
      this.seekPending = { id, resolve };
      this.worker?.postMessage({ type: "seek", id, positionSeconds: target });
    });

    // A newer seek landed while this one was in flight; that one owns the state.
    if (epoch !== this.seekEpoch) return;
    this.pump();
  }

  /** Begin supervising liveness. Idempotent; a running watchdog is left alone. */
  private startWatchdog(): void {
    this.lastAudioAtMs = Date.now();
    if (this.watchdogTimer !== null) return;
    this.watchdogTimer = setInterval(() => this.checkLiveness(), WATCHDOG_TICK_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer === null) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /**
   * Is the engine failing to produce audio it is supposed to be producing?
   *
   * Every condition here is a reason it is legitimately quiet, and is therefore NOT a stall:
   * nothing loaded, the tune ended, deliberately paused, or a recovery already under way. What is
   * left — supposed to be playing, buffer empty, and nothing scheduled for
   * {@link AUDIO_STALL_TIMEOUT_MS} — cannot right itself, because the only thing that would pump
   * the next chunk is the chunk that never came.
   */
  private checkLiveness(): void {
    if (!this.scheduler || this.endReceived || this.paused || this.stallRecoveryInFlight) return;
    if (this.scheduler.bufferedSeconds() > STARVED_BUFFER_SECONDS) return;
    if (Date.now() - this.lastAudioAtMs < AUDIO_STALL_TIMEOUT_MS) return;
    void this.recoverFromStall();
  }

  /**
   * Put a stalled tune back on the air: throw the worker away and re-open the same tune where it
   * fell silent.
   *
   * The bytes have to be kept for this — `play()` transfers ownership of the caller's buffer to the
   * worker, so by the time it stalls there is nothing left to re-open with. A SID is a few KB, so
   * the copy costs nothing worth counting.
   *
   * Once per tune. If a re-opened tune stalls again the fault is not transient, and retrying on a
   * timer would spend the rest of the track restarting instead of playing; the playlist's own
   * advance already moves on at the songlength. Recovery is announced either way — silence that
   * repaired itself is still worth knowing about.
   */
  private async recoverFromStall(): Promise<void> {
    const tune = this.currentTune;
    const resumeAt = this.scheduler?.positionSeconds() ?? 0;
    addErrorLog("Local SID playback stalled", {
      service: "local-sid",
      positionSeconds: Math.round(resumeAt),
      recoverable: Boolean(tune) && !this.stallRecoveryUsed,
    });
    if (!tune || this.stallRecoveryUsed) {
      // Nothing to re-open, or this tune has had its turn. Say the tune is over rather than leave
      // the app showing a track that is playing nothing.
      this.endReceived = true;
      this.maybeFireEnded();
      this.callbacks.onUnrecoverable?.();
      return;
    }
    this.stallRecoveryInFlight = true;
    this.stallRecoveryUsed = true;
    this.discardWorker("audio stalled");
    try {
      // `play()` resets the per-tune state, including the flag above, so restore it afterwards:
      // this restart must not hand the same tune a second free recovery.
      await this.play(tune.bytes.slice(0), tune.songIndex, this.callbacks);
      this.stallRecoveryUsed = true;
      if (resumeAt > 0) await this.seekTo(resumeAt);
      addLog("info", "Local SID playback recovered from a stall", {
        service: "local-sid",
        resumedAtSeconds: Math.round(resumeAt),
      });
    } catch (error) {
      addErrorLog("Local SID playback could not recover from a stall", {
        service: "local-sid",
        error: error instanceof Error ? error.message : String(error),
      });
      this.endReceived = true;
      this.maybeFireEnded();
      this.callbacks.onUnrecoverable?.();
    } finally {
      this.stallRecoveryInFlight = false;
    }
  }

  /** Request renders until the buffer is full ahead of the clock. */
  private pump(): void {
    if (!this.scheduler || this.endReceived) return;
    // Playing from a cached render: slice the next chunk straight out of the
    // buffer. No worker, no rendering, no waiting.
    if (this.cached) {
      const { pcm, channels, sampleRate } = this.cached;
      const chunkSamples = Math.floor(this.chunkSeconds * sampleRate) * channels;
      while (this.scheduler.bufferedSeconds() < this.targetBufferSeconds) {
        if (this.cachedCursor >= pcm.length) {
          this.endReceived = true;
          this.maybeFireEnded();
          return;
        }
        const end = Math.min(pcm.length, this.cachedCursor + chunkSamples);
        // A copy, because the scheduler hands the buffer to Web Audio.
        const slice = pcm.slice(this.cachedCursor, end);
        this.cachedCursor = end;
        this.recordRender(0, slice.length);
        this.scheduler.schedule(slice, channels);
        this.emitPosition();
      }
      return;
    }
    if (!this.worker) return;
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
    // `scheduled === 0` is not "not finished yet", it is "there was never any
    // audio": seeking to or past the end of a fully-rendered tune exhausts the
    // cache on the first pump, before anything is queued. Waiting for chunks
    // that will never exist left the engine silent and never-ending.
    if (scheduled === 0 || this.chunksEnded >= scheduled) {
      this.endedFired = true;
      this.callbacks.onEnded?.();
      // The tune is over. Listeners deriving "is anything playing" from the
      // engine must re-read, or a finished tune keeps offering Pause.
      notifyPlaybackActivityChanged();
    }
  }

  private emitPosition(): void {
    if (!this.scheduler) return;
    this.callbacks.onPosition?.(this.scheduler.positionSeconds());
  }

  private recordRender(renderMs: number, samples: number): void {
    // Both paths that put audio on the timeline — a worker chunk and a slice of a pre-rendered
    // tune — come through here immediately before scheduling it, which makes this the one place
    // that means "the pipeline is alive".
    this.lastAudioAtMs = Date.now();
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
    // A pre-render runs on its own worker, in the background, for a tune that is
    // very likely playing perfectly. Its failure means seeks fall back to the
    // slow path — it is NOT a playback failure, and reporting it as one told the
    // user (and the logs) that a working tune had failed.
    if (code === "prerender") {
      addErrorLog("Local SID pre-render failed; seeking falls back to re-rendering", {
        service: "local-sid",
        error: message,
      });
      this.abandonPrerender();
      return;
    }
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
    this.paused = true;
    await this.audio?.suspend?.();
  }

  /** Resume after {@link pause}. */
  async resume(): Promise<void> {
    this.paused = false;
    // The buffer drained while the clock was suspended; give the pipeline the same grace a fresh
    // start gets rather than judging it on how long the pause lasted.
    this.lastAudioAtMs = Date.now();
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
    // Remember which tune is open even when it is already cached, so a later
    // seek can find it.
    this.currentKey = key;
    if (this.renderCache.has(key) || !this.worker || seconds <= 0) return;
    const roms = loadStoredRoms();
    if (!roms.kernal || !roms.basic) return;
    // A pre-render still running for a previous tune is now dead weight, and
    // its worker would render it to the end before touching this one. Killing
    // the thread stops that work immediately rather than queueing behind it.
    if (this.prerenderFraction !== null) this.abandonPrerender();
    this.prerenderId += 1;
    this.prerenderKey = key;
    this.prerenderFraction = 0;
    const kernal = roms.kernal.slice().buffer;
    const basic = roms.basic.slice().buffer;
    this.ensurePrerenderWorker().postMessage(
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
    // `isActive()` flips here, so this is where the app is told.
    //
    // NOT the only place the app needs telling: a tune that simply runs out does
    // NOT come through here. It fires `onEnded` (see maybeFireEnded, which
    // notifies separately) and leaves the scheduler in place, so `isActive()`
    // stays true until something explicitly stops or replaces the tune. Wiring
    // end-of-tune teardown is a wider change than this one — auto-advance is
    // driven by the songlength clock in PlayFilesPage, not by `onEnded`, which
    // no caller currently installs.
    const wasActive = this.scheduler !== null;
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
    this.stopWatchdog();
    this.paused = false;
    this.currentTune = null;
    // Settle an open that this stop just cancelled, rather than dropping its resolver.
    //
    // `onOpened` only answers a reply whose id is still `activeId`, and the line above has just
    // cleared that, so nothing else can ever settle this promise — its caller is an `await` in the
    // middle of starting a track and would wait forever. `play()` calls `stopPlayback` before
    // registering its own open, so skipping quickly through a playlist walks straight into it: an
    // ordinary second press on Next, not a corner case. Resolving is honest — this open was
    // cancelled before anything started, which is what the result says.
    this.openPending?.resolve({
      romRequired: false,
      started: false,
      sampleRate: this.requestedSampleRate,
      channels: this.channels,
      tuneInfo: null,
    });
    this.openPending = null;
    this.callbacks = {};
    this.inFlightRenders = 0;
    this.endReceived = false;
    this.endedFired = false;
    this.chunksEnded = 0;
    this.cached = null;
    this.cachedCursor = 0;
    this.currentKey = null;
    // Render throughput is deliberately NOT reset here: it measures what this
    // device sustains across the whole engine session, so a multi-track soak
    // (§12.6) reports one p99 over every tune rather than only the last one.
    if (wasActive) notifyPlaybackActivityChanged();
  }

  /** Tear down the worker + audio entirely (release WASM memory). */
  dispose(): void {
    this.stopPlayback();
    // The pre-render thread holds a second WASM instance and would otherwise
    // keep rendering a tune nobody is listening to.
    this.abandonPrerender();
    this.stopWatchdog();
    this.worker?.terminate();
    this.worker = null;
    this.moduleReady = false;
    this.loadPending = null;
    // The memo would otherwise promise a module that lives in a worker we just terminated.
    this.loadInFlight = null;
    this.totalRenderMs = 0;
    this.totalRenderedSeconds = 0;
    this.peakRenderMsPerSec = 0;
    this.renderRates = [];
  }
}
