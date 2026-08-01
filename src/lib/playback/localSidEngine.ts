/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { LocalSidChunkScheduler, type AudioScheduleSink, type AudioScheduleSource } from "./localSidChunkScheduler";
import type { LocalSidMainToWorker, LocalSidWorkerToMain, LocalSidOpenedMessage } from "./localSidWorkerProtocol";
import { toEngineSidModel } from "./localSidWorkerProtocol";
import { hasCompleteRomSet, loadStoredRoms } from "@/lib/roms/romStore";
import { Capacitor } from "@capacitor/core";
import {
  effectiveSidEmulationEngine,
  loadPlaybackCrossfadeMs,
  resolveLocalSidModel,
  type SidEmulationEngine,
} from "@/lib/config/appSettings";
import { StreamUdp } from "@/lib/native/streamUdp";
import {
  createNativeLocalSidSink,
  nativeLocalAudioAvailable,
  type NativeLocalAudioBackend,
} from "./localSidNativeSink";
import { accurateEngineViable, recordRenderMeasurement, renderRatio, startupBufferSeconds } from "./renderThroughput";
import { addLog, addErrorLog } from "@/lib/logging";
import { claimPhoneAudio, phoneAudioOwner, releasePhoneAudio } from "@/lib/audio/phoneAudioOwnership";
import { clearLocalAudioHealth, reportLocalAudioHealth } from "@/lib/streams/localAudioHealthSignal";
import { notifyPlaybackActivityChanged } from "./playbackActivitySignal";
import type { PendingSeekState } from "./pendingSeekStatus";
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

  /**
   * Cumulative underruns the OUTPUT itself reported, where the sink can see them.
   *
   * The chunk scheduler counts a chunk handed over after the previous one finished, which is the
   * right measure for the Web Audio sink because there the schedule *is* the output. The native sink
   * writes into a ring the speaker drains on its own thread, so the ring can run dry while every
   * chunk was handed over on time — the scheduler sees nothing and the listener hears a gap. That is
   * the shape of defect this repo has already been caught by once (AGENTS.md, "Diagnostics that
   * cannot report the fault"), so the pinned `audioUnderruns` budget takes the worse of the two.
   */
  audioUnderruns?: () => number;
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
  /**
   * Whether the speaker has been handed a flat signal for long enough to be a fault.
   *
   * The invariant is "no silent playback unless the listener asked for silence". Every other
   * counter here describes supply and demand — frames written, buffer depth, underruns — and all of
   * them look perfectly healthy while a tune renders a flat line. See `SilenceDetector`.
   */
  isSilentFault?: () => boolean;
  /** Judge the next stretch afresh: a new tune, a resume, or a recovery just attempted. */
  resetSilence?: () => void;
  /**
   * Hand over audio rendered but not yet played, so the next tune can fade it out underneath itself.
   *
   * A crossfade needs both tunes sounding at once and there is only one output. Two sinks writing to
   * it interleave rather than mix, and a sink's gain ramp is applied when a slice is converted, so it
   * cannot reach audio already converted. The incoming sink therefore does the mixing.
   */
  takeCrossfadeTail?: (seconds: number) => Int16Array[];
  /** Sum a predecessor's tail under this sink's own output, fading it away across `seconds`. */
  adoptCrossfadeTail?: (slices: Int16Array[], seconds: number) => void;
  /**
   * Throw away audio already handed to the output, for a seek.
   *
   * Web Audio needs nothing here — stopping the scheduled sources is enough. A native sink does:
   * it holds seconds of audio the speaker has not reached yet, so without this a seek would go on
   * playing the old position for as long as that buffer is deep. That is what broke fast-forward,
   * rewind and the progress bar when on-device playback moved to the native path.
   */
  flush?: () => void;
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

/** The one failure `play` retries: see there for why, and why only once. */
const OPEN_TIMEOUT_MESSAGE = `Local SID engine did not open the tune within ${WORKER_REPLY_TIMEOUT_MS}ms`;

const isOpenTimeoutError = (error: unknown) => error instanceof Error && error.message === OPEN_TIMEOUT_MESSAGE;

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
 * How long to wait for the worker to acknowledge a seek before reopening the audio gate.
 *
 * `seekPending` suppresses every rendered chunk so the audio from the position just left is never
 * scheduled. That is correct while a seek is genuinely in flight and ruinous the moment it is not:
 * an unacknowledged seek would discard chunks for as long as the tune lasts. Generous next to a
 * seek that lands, so this only fires when the reply is genuinely never coming.
 *
 * Generous because a seek is not a quick acknowledgement: the worker serialises it behind the
 * renders already queued, and then renders and discards everything between the current position
 * and the target, so seeking deep into a long tune is real emulation work. Cutting it short would
 * only trade a slow seek for a wrong one, and this is a recovery rather than a failure — the gate
 * reopens and playback carries on from wherever the engine actually is.
 */
const SEEK_ACK_TIMEOUT_MS = 20_000;

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

/**
 * The native track, when this platform has one.
 *
 * Preferred over Web Audio because the two do not sound the same. Web Audio inside the WebView lands
 * on a direct output that bypasses the mixer's effect chain — on a Pixel 4 that chain is the
 * speaker's own EQ, and without it on-device playback measured 7.5 dB quieter with a thirtieth of the
 * energy in 120-300 Hz, against the identical PCM sent through the mirror's native track. See
 * `localSidNativeSink` for the measurements. Null on the web build and on iOS, where the plugin does
 * not exist ([[streamudp-android-only]]): those fall back to Web Audio, which is all they have.
 */
const nativeAudioBackend = (): NativeLocalAudioBackend | null => {
  // The same predicate the buffer sizes are chosen from, so the two can never disagree about which
  // sink this platform is going to get.
  if (!nativeLocalAudioAvailable()) return null;
  return StreamUdp as unknown as NativeLocalAudioBackend;
};

const webAudioSinkFactory: LocalSidAudioSinkFactory = (sampleRate: number) => {
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
/**
 * Native where it exists, Web Audio everywhere else.
 *
 * Not a preference — the two paths measurably do not sound alike, and the native one is the same
 * path the A/V mirror uses, which is the whole point: "Listen on: this device" and "Both" should
 * reach the speaker through identical processing.
 */
const defaultAudioSinkFactory: LocalSidAudioSinkFactory = (sampleRate: number) =>
  createNativeLocalSidSink(sampleRate, nativeAudioBackend()) ?? webAudioSinkFactory(sampleRate);

const RENDER_RATE_SAMPLES = 4096;

const EMPTY_PCM = new Int16Array(0);
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
/**
 * How far ahead the engine renders.
 *
 * Deep on the native path, and deliberately so. The mirror never drops out because its PCM arrives on
 * a native receive thread and goes straight into the native ring — JavaScript is not in the path at
 * all. On-device playback renders in WASM and has to hand the samples over the bridge from the JS
 * thread, which also runs the UI, the renderer and garbage collection. Pacing that finely was tried
 * and failed repeatedly; the answer is not finer pacing but a buffer deep enough that JS only has to
 * be roughly on time. Web Audio keeps the shallower figure: it has no bridge to cross.
 */
const DEFAULT_TARGET_BUFFER_SECONDS = nativeLocalAudioAvailable() ? 20 : 4;
const DEFAULT_SAMPLE_RATE = 48000;
/**
 * Cap concurrent render requests, so a slow device cannot queue work unboundedly.
 *
 * Derived from the target rather than picked, because the two are the same decision: it has to be high
 * enough to refill the buffer promptly after a stall, and low enough that a device which cannot keep up
 * does not accumulate a backlog it will never work through. A fifth of the target is the balance — at
 * half-second chunks that is 2 s of catch-up on the shallow Web Audio target and 4 s on the deep native
 * one — with a floor so the shallow case keeps the four it always had.
 *
 * It used to be a bare number written for the 4-second target, and doubling it when the native target
 * became 20 s left the relationship between them implicit and wrong on one of the two paths.
 */
const MAX_IN_FLIGHT_RENDERS = Math.max(4, Math.ceil(DEFAULT_TARGET_BUFFER_SECONDS / DEFAULT_CHUNK_SECONDS / 5));

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
  /** Guards {@link play}'s single retry after an open timeout, so a retry can never retry itself. */
  private openRetryInFlight = false;
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
  /** Set while the running pre-render is only a lead-in, not the whole tune. */
  private prerenderPartialSeconds: number | null = null;
  /** Slices of the running pre-render, accumulated so the cache can grow as it goes. */
  private prerenderAccumulated: Int16Array = EMPTY_PCM;
  /**
   * A second offline renderer, for the tracks either side of the one playing.
   *
   * Separate from the pre-render worker on purpose. `prerender` abandons whatever it finds in flight,
   * so sharing one thread meant warming a neighbour cancelled the current tune's full render — and
   * that render is what makes seeking inside it instant. Its own thread means the two never compete,
   * which is also what lets a neighbour be warmed immediately rather than queued behind a tune that
   * takes half a minute to render.
   */
  private warmWorker: LocalSidWorkerLike | null = null;
  private warmId = 0;
  private warmKey: string | null = null;
  private warmAccumulated: Int16Array = EMPTY_PCM;
  /**
   * A seek waiting for the pre-render to reach it.
   *
   * Set when a seek lands past what is rendered while a pre-render of this tune is already running.
   * Playback resumes from the buffer the moment coverage passes it — which is what the progress bar's
   * translucent fill is showing in the meantime.
   *
   * A record rather than a bare number because three things about the request outlive the moment it
   * was made. The render head as it stood when the target was accepted is the denominator of the
   * preparation progress the UI shows, and reading it later would give a figure that starts at
   * whatever fraction happened to be rendered. The last genuinely audible position is where the
   * elapsed clock has to freeze, because the scheduler has already been reset to the target. And the
   * two identities let a render completion that arrives late be matched against what is actually
   * outstanding rather than applied to whatever is playing now.
   */
  private pendingSeek: PendingSeekState | null = null;
  /**
   * Identity of the track instance currently open.
   *
   * Bumped by every open, so a pre-render completion that arrives after the listener has pressed
   * Next can be told apart from one for the tune now playing. Without it, a completion is matched
   * only by pre-render id, and ids are per-engine rather than per-tune.
   */
  private trackInstanceId = 0;
  /** The cache key of the tune being opened, re-applied after the teardown that clears it. */
  private pendingCacheKey: string | null = null;
  /** Lead-ins waiting for the renderer to be free, so they never displace the current tune's. */
  private readonly pendingWarms = new Map<string, { sidBytes: ArrayBuffer; songIndex: number; seconds: number }>();
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
  /**
   * Playback is being fed from the pre-render's buffer while that pre-render is still growing it.
   *
   * Set when an awaited seek is finally served, and it is what stops that moment turning straight
   * back into another silence. The buffer that satisfies the seek ends barely past the target — it
   * is the chunk that just crossed it — so there is almost nothing after the resume point. Handing
   * back to the live renderer there means asking a renderer that cannot rewind to reach a position
   * three minutes in, which is the whole tune re-rendered with the audio gated shut: measured on a
   * Pixel 4 as a second of music after a seventy-second wait, followed by a minute of nothing.
   *
   * The renderer that is about to produce exactly the needed audio is the pre-render, which is still
   * running and ahead. So playback follows it: every chunk it emits extends the buffer being played
   * from, and the hand-off waits until it has finished (or died).
   */
  private followingPrerender = false;
  /** Key of the tune currently open, so a finished pre-render can be matched to it. */
  private currentKey: string | null = null;
  private volume = 1;
  private muted = false;
  /** Crossfade length to apply to the tune currently being opened (0 = cut). */
  private pendingCrossfadeMs = 0;
  /** The outgoing tune's audio, waiting for the incoming sink to fade it out underneath itself. */
  private crossfadeTail: Int16Array[] | null = null;
  /** How long that tail should take to disappear. */
  private crossfadeSeconds = 0;
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
    // A seek waiting on this render is now waiting on a thread that will never report again. Drop
    // it rather than leave it outstanding: while it is set the UI shows a wait that cannot end and
    // the stall watchdog is held off, so clearing it is what lets the ordinary recovery run.
    const awaited = this.pendingSeek;
    this.pendingSeek = null;
    // Playback reading from that render is in the same position: no further chunk will extend the
    // buffer it is playing from, so it has to go back to the live renderer or fall silent when the
    // buffer runs out. The hand-off is expensive — the live renderer cannot rewind — but it is the
    // only source of the rest of the tune once this thread has gone.
    //
    // Where to send it depends on which of the two states this interrupted. Following the render
    // means resuming from the end of what was cached. A seek still waiting means the listener has
    // been promised a position that nothing is now working towards, and the live renderer is the
    // only thing that can still reach it — a thread dying on its first chunk leaves no cache at all,
    // which is the case that otherwise fell through here with playback silently stuck until the
    // watchdog noticed.
    const wasFollowing = this.followingPrerender;
    this.followingPrerender = false;
    if (wasFollowing || awaited) {
      const seam = this.cached?.durationSeconds ?? 0;
      const target = seam > 0 ? seam : (awaited?.targetSeconds ?? 0);
      if (target > 0) this.beginPartialHandoff(target);
    }
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
      // Chosen against the ROMs actually stored, not just the preference: the accurate engine cannot
      // render a note without them. The worker is loaded once, so a set of ROMs that arrives later
      // takes effect on the next worker rather than mid-tune — which is the same rule the emulation
      // preference itself already follows.
      worker.postMessage({ type: "load", engine: this.chosenEmulation() });
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
    /**
     * Cache key for this tune, if the caller has one.
     *
     * Given here rather than only to `prerender` because the engine has to know it *before* the tune
     * opens: opening is where a warmed lead-in gets poured into the buffer, and a key that only
     * arrives afterwards is a warm cache that is never found.
     */
    cacheKey?: string,
  ): Promise<LocalSidPlayResult> {
    // A new track instance, so anything still in flight for the previous one can be told apart from
    // this one's work. A stall recovery re-opens the same tune and counts as a new instance too:
    // what the old instance was waiting for did not survive the worker being thrown away.
    this.trackInstanceId += 1;
    // The listener has left whatever they were waiting for. `activePendingSeek` would discard it
    // on the next read anyway; clearing it here as well keeps `debugState()` and anything reading
    // the field directly honest from the first moment of the new tune.
    this.pendingSeek = null;
    this.followingPrerender = false;
    // Every other per-tune latch as well. `seekTo` and `stop` both clear these; opening a tune did
    // not, so a skip carried the previous tune's state into the new one — an `endReceived` left set
    // stands the stall watchdog down for good, and an inflated render budget stops `pump()` before
    // it starts.
    this.inFlightRenders = 0;
    this.endReceived = false;
    this.endedFired = false;
    this.chunksEnded = 0;
    // Remembered, not just assigned. Opening a tune tears the previous one down, and that teardown
    // clears `currentKey` — so setting it here and nothing else left it null for the whole tune. With it
    // null the pre-render cache cannot be found by any of the three things that need it: the progress
    // bar's rendered fill, a seek that could have been instant, and the seek that waits for the renderer
    // instead of racing it. Every one of those silently took its slow path.
    if (cacheKey) {
      this.pendingCacheKey = cacheKey;
      this.currentKey = cacheKey;
    }
    // Keep a copy before `openTuneOnce` transfers ownership of the caller's buffer to the worker,
    // so a retry has something left to open with.
    const retryBytes = sidBytes.slice(0);
    try {
      return await this.openTuneOnce(sidBytes, songIndex, callbacks);
    } catch (error) {
      // An open that times out is nearly always transient: the device was busy — often finishing
      // the seek this tune replaced, or emulating for a worker that has been told to stop but has
      // not yet — and the very next attempt succeeds within a couple of seconds. Measured on a
      // Pixel 4, one open in a scrub-heavy session exceeded 15 s while every other took about two.
      //
      // Failing outright is far worse than the wait: the track change is lost, playback stops, and
      // it stays stopped until the listener works out that they have to start it again. So try
      // once more on the worker the timeout has already discarded. Once only — a second timeout is
      // not bad luck, and retrying on a timer would spend the track restarting instead of playing.
      if (this.openRetryInFlight || !isOpenTimeoutError(error)) throw error;
      addLog("warn", "Local SID engine: tune open timed out; retrying once", {
        service: "local-sid",
        songIndex,
      });
      this.openRetryInFlight = true;
      try {
        return await this.openTuneOnce(retryBytes, songIndex, callbacks);
      } finally {
        this.openRetryInFlight = false;
      }
    }
  }

  /** One attempt at {@link play}. See there for why there can be a second. */
  private async openTuneOnce(
    sidBytes: ArrayBuffer,
    songIndex: number,
    callbacks: LocalSidPlayCallbacks = {},
  ): Promise<LocalSidPlayResult> {
    // A seek still running belongs to a tune nobody is listening to any more, and it cannot be
    // called off: seeking reloads the tune and fast-forwards to the target, so a seek near the end
    // of a long one re-emulates minutes of C64 in a single call the worker cannot interrupt. The
    // queue is strictly ordered, so this tune's `open` would wait all of it out — on a Pixel 4,
    // scrub-then-skip spent longer there than the open's own 15 s timeout allows, and the track
    // change was lost with the worker written off as unresponsive.
    //
    // A new tune inherits nothing from the old one, so start clean rather than queue behind it.
    // Renders do not get this treatment: there are at most a handful, each a fraction of a second
    // of audio, and a device that could not clear them faster than that could not play at all.
    if (this.seekPending) this.discardWorker("a new tune superseded an unfinished seek");
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
        reject(new Error(OPEN_TIMEOUT_MESSAGE));
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
        {
          type: "open",
          id,
          sidBytes,
          songIndex,
          sampleRate: this.requestedSampleRate,
          roms: romPayload,
          // Read per-play, like the ROMs above and for the same reason: changing the chip in
          // Settings then applies from the very next tune rather than after a restart.
          sidModel: toEngineSidModel(resolveLocalSidModel()),
        },
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
      case "prerender-chunk": {
        // Accumulate as it arrives, and publish the growing buffer to the cache each time. That is
        // what makes a seek into the part already rendered instant instead of waiting for the whole
        // tune, and it is what the progress bar's pre-render fill reads.
        if (message.id !== this.prerenderId || !this.prerenderKey) return;
        const grown = new Int16Array(this.prerenderAccumulated.length + message.pcm.length);
        grown.set(this.prerenderAccumulated, 0);
        grown.set(message.pcm, this.prerenderAccumulated.length);
        this.prerenderAccumulated = grown;
        // A seek is waiting on this: hand playback the buffer the moment coverage reaches the target,
        // rather than leaving it silent while a second render of the same audio catches up.
        //
        // Only for a target that is still the outstanding one. A pending seek from a previous track
        // instance, or one a newer seek has already superseded, must be discarded rather than
        // applied — applying it would jump the tune now playing to a position somebody asked for in
        // a different one.
        // Wait for a cushion past the target, not merely for the target.
        //
        // The chunk that crosses the target leaves nothing after it, so resuming exactly there
        // starts playback with no headroom at all: the speaker consumes one second per second and
        // the renderer is only just ahead. The same question — how much has to be in hand before
        // starting so it cannot run dry — is what the measured start-up buffer already answers, so
        // it answers this one too. It costs a fraction of a second more waiting on a wait that is
        // measured in tens of them.
        const cushion = startupBufferSeconds();
        const awaiting = this.activePendingSeek;
        if (awaiting !== null && message.seconds > awaiting.targetSeconds + cushion) {
          const awaited = awaiting.targetSeconds;
          this.pendingSeek = null;
          this.cached = {
            partial: true,
            pcm: grown,
            sampleRate: message.sampleRate,
            channels: message.channels,
            durationSeconds: message.seconds,
          };
          this.cachedCursor = Math.min(grown.length, Math.floor(awaited * message.sampleRate) * message.channels);
          // Deliberately NOT a hand-off to the live renderer: see `followingPrerender`. The thread
          // that is already producing this audio keeps producing it.
          this.followingPrerender = true;
          addLog("debug", "Local SID awaited seek served by the running pre-render", {
            service: "local-sid",
            seconds: awaited,
            renderedSeconds: message.seconds,
            cushionSeconds: Math.round(cushion * 100) / 100,
          });
          this.pump();
        } else if (this.followingPrerender && this.cached) {
          // Playback is reading from this buffer as it grows. Republish the extended one, keeping
          // the cursor where it is — the slices already scheduled are a prefix of it.
          this.cached = {
            partial: true,
            pcm: grown,
            sampleRate: message.sampleRate,
            channels: message.channels,
            durationSeconds: message.seconds,
          };
          this.pump();
        }
        this.renderCache.set(this.prerenderKey, {
          // Still growing, so it must not be mistaken for the whole tune: running off the end has to
          // hand over to live rendering rather than fire "ended".
          partial: true,
          pcm: grown,
          sampleRate: message.sampleRate,
          channels: message.channels,
          durationSeconds: message.seconds,
        });
        return;
      }
      case "prerendered": {
        if (message.id !== this.prerenderId || !this.prerenderKey) return;
        this.prerenderFraction = null;
        // Only a lead-in was asked for, so what is cached remains a partial even though the render
        // finished. A full render becomes authoritative: seeks inside it are pure buffer offsets and
        // running off its end really is the end of the tune.
        const partial = this.prerenderPartialSeconds !== null;
        this.prerenderPartialSeconds = null;
        const pcm = this.prerenderAccumulated;
        this.prerenderAccumulated = EMPTY_PCM;
        queueMicrotask(() => this.drainPendingWarms());
        if (pcm.length > 0) {
          this.renderCache.set(this.prerenderKey, {
            partial,
            pcm,
            sampleRate: message.sampleRate,
            channels: message.channels,
            durationSeconds: message.seconds,
          });
        }
        // A wait the last chunk did not satisfy has nothing left to wait FOR — the render is over,
        // so no further "prerender-chunk" can ever arrive. Left outstanding, the target latches the
        // engine into a silence the stall watchdog is deliberately forbidden to judge, and the tune
        // never reports its end either. Dragging into the closing seconds of a tune reaches this.
        this.resolvePendingSeekAgainstCompletedRender(pcm, message.sampleRate, message.channels, message.seconds);
        // Playback was following this render as it grew. It has stopped growing, so whatever is in
        // hand is now all there will be — which means the flag comes off here unconditionally. A
        // render that finished with nothing to show for it is the case that matters: leaving the
        // flag set would leave `pump` waiting for a chunk that can no longer arrive, and the only
        // thing that would notice is the stall watchdog, seconds later and by killing the worker.
        if (this.followingPrerender) {
          this.followingPrerender = false;
          if (pcm.length > 0) {
            // Adopt the finished buffer and let its `partial` flag decide what running off the end
            // means: a full render's end is the tune's end, a lead-in's end is where the live
            // renderer has to take over.
            this.cached = {
              partial,
              pcm,
              sampleRate: message.sampleRate,
              channels: message.channels,
              durationSeconds: message.seconds,
            };
            if (partial) this.beginPartialHandoff(message.seconds);
          } else {
            // Nothing was produced, so the live renderer is the only remaining source of the rest of
            // the tune — expensive, because it cannot rewind, and better than falling silent.
            const seam = this.cached?.durationSeconds ?? 0;
            if (seam > 0) this.beginPartialHandoff(seam);
          }
          this.pump();
        }
        addLog("debug", "Local SID tune pre-rendered", {
          service: "local-sid",
          key: this.prerenderKey,
          seconds: Math.round(message.seconds),
          partial,
          megabytes: +(pcm.byteLength / 1024 / 1024).toFixed(1),
          cachedTunes: this.renderCache.size,
          cacheMegabytes: +(this.renderCache.bytes / 1024 / 1024).toFixed(1),
        });
        return;
      }
      case "chunk": {
        // The budget is settled first, before any of the reasons this chunk might be thrown away.
        //
        // `pump()` counts a render when it posts one and refuses to post more at
        // `MAX_IN_FLIGHT_RENDERS`. That count is a record of work outstanding in the worker, not of
        // audio worth keeping: the render has finished either way, and the slot belongs back in the
        // budget either way. Returning above the decrement — which all three discards below used to
        // do — spent a slot permanently every time a chunk was dropped. Skipping is what made it
        // add up, because every render still in flight when the next tune opens comes back with the
        // previous tune's id and is dropped; once the budget was gone `pump()` could never ask for
        // audio again and the tune went silent with the clock still running.
        this.inFlightRenders = Math.max(0, this.inFlightRenders - 1);
        if (message.id !== this.activeId) return; // stale tune
        // The worker handles messages in order, so anything still arriving
        // before the "seeked" reply was rendered for the position we just left.
        // Scheduling it would play the wrong part of the tune.
        if (this.seekPending) return;
        // The same is true for a seek waiting on the pre-render, and for a less obvious reason: that
        // path never repositions the live renderer at all, precisely so it does not pay for a second
        // re-render. So the live worker is still sitting at the position the listener just left, and
        // every chunk it produces is that old audio. Scheduling it plays the part of the tune the
        // listener seeked AWAY from while the bar, the clock and the status all describe the target —
        // the exact "heard the old position while the bar showed the new one" failure the wait exists
        // to avoid. Flushing the queued audio was not enough on its own, because the renderer kept
        // refilling it.
        if (this.activePendingSeek) return;
        this.recordRender(message.renderMs, message.samples);
        // Learn how fast this device renders, so the next tune knows how much to buffer before it
        // starts. Only real renders count — a chunk served from the cache took no time and would
        // teach the wrong lesson.
        recordRenderMeasurement(
          message.samples / Math.max(1, this.channels) / this.requestedSampleRate,
          message.renderMs,
        );
        this.scheduler?.schedule(message.pcm, this.channels);
        this.emitPosition();
        this.pump();
        return;
      }
      case "end": {
        // Settled before the discards, for the same reason as "chunk": the render is over whether
        // or not its result is wanted.
        this.inFlightRenders = Math.max(0, this.inFlightRenders - 1);
        if (message.id !== this.activeId) return;
        // Same reasoning as "chunk": an end raised before the seek completed
        // describes the old position and must not finish the tune.
        if (this.seekPending) return;
        // And an end that arrives while a seek waits on the pre-render describes the live renderer
        // running off the tune from the OLD position. The tune the listener is waiting for has not
        // finished; ending it here would skip to the next track mid-wait.
        if (this.activePendingSeek) return;
        this.endReceived = true;
        this.maybeFireEnded();
        return;
      }
      case "seeked": {
        if (this.seekPending?.id !== message.id) return;
        const pending = this.seekPending;
        this.seekPending = null;
        // The worker has just proved it is alive AND finished repositioning, so the first chunk
        // from the new position deserves a full window rather than what is left of the one the
        // seek spent. Without this, a seek that took most of the grace period was declared a stall
        // the moment it succeeded.
        this.lastAudioAtMs = Date.now();
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
    // Re-applied here because the teardown between tunes cleared it.
    if (this.pendingCacheKey) this.currentKey = this.pendingCacheKey;
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
    // A new tune gets its own silence clock; the previous tune's quiet ending is not its fault.
    this.audio.resetSilence?.();
    // And it inherits the outgoing tune's tail, so the two overlap instead of butting together.
    if (this.crossfadeTail?.length) {
      this.audio.adoptCrossfadeTail?.(this.crossfadeTail, this.crossfadeSeconds);
      this.crossfadeTail = null;
    }
    // Supervise from the moment there is something to supervise. The clock starts here rather than
    // at the first chunk, so a tune that never produces one at all is caught too.
    this.startWatchdog();
    // Start from whatever of this tune is already rendered. Without this the engine has to out-render
    // the speaker from a standing start — it manages only about 2.3x real time while warming up — so
    // the ring could still run dry a second or two in, heard as a single short pause right at the
    // beginning of a track. That is the worst possible moment for one: it is where a listener decides
    // whether the player is trustworthy.
    const warmed = this.currentKey ? this.renderCache.get(this.currentKey) : null;
    if (warmed) {
      this.cached = warmed;
      this.cachedCursor = 0;
      if (warmed.partial) {
        // Position the live renderer at the seam NOW, while the cache is still playing, so the
        // hand-off costs nothing when it arrives.
        this.beginPartialHandoff(warmed.durationSeconds);
      }
    }
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
    // Read the playhead BEFORE the scheduler is reset, because that reset moves it to the target.
    // If this seek ends up waiting, this is the last position the listener genuinely heard, and it
    // is where the elapsed clock has to stay: a clock advancing from the target while the engine
    // renders towards it is a silent wait dressed up as normal playback.
    const audibleAtRequest = this.scheduler.positionSeconds();
    // A newer seek replaces whatever an older one was waiting for.
    this.pendingSeek = null;
    // And it decides afresh where playback reads from. Following the pre-render is a state the
    // previous seek entered; this one either re-enters it, finds the cache can answer outright, or
    // goes to the worker. Carrying it over would leave a later `prerender-chunk` extending a buffer
    // nothing is playing from any more.
    this.followingPrerender = false;
    this.inFlightRenders = 0;
    this.endReceived = false;
    this.endedFired = false;
    this.chunksEnded = 0;
    this.scheduler.resetTo(target);
    // Stopping the scheduled sources is not enough on a native sink: the audio it has already been
    // given is queued ahead of the speaker and would keep playing the old position.
    this.audio?.flush?.();
    this.emitPosition();

    // If this tune has been rendered in full, the seek is a buffer offset and
    // needs no engine round-trip at all. That is the whole point of the
    // pre-render: libsidplayfp cannot rewind, so asking the engine to go
    // backwards costs ~150 ms of CPU per second of audio it has to replay —
    // seconds of silence for a seek the listener expects to be instant.
    const rendered = this.currentKey ? this.renderCache.get(this.currentKey) : null;
    // A lead-in only covers the opening, so it can answer a seek that lands inside it and nothing
    // else. Serving one as though it were the whole tune is how fast-forward, rewind and the progress
    // bar all broke at once: the cursor clamped to the end of the cached span, so every seek past it
    // resumed from the seam instead of where the listener asked.
    const usable = rendered && (!rendered.partial || target < rendered.durationSeconds);
    if (rendered && usable) {
      this.cached = rendered;
      this.cachedCursor = Math.min(rendered.pcm.length, Math.floor(target * rendered.sampleRate) * rendered.channels);
      // Landing inside a lead-in still has to leave the tune able to continue past it, so the live
      // renderer is sent to the seam while the cache plays out — the same hand-off as at open.
      if (rendered.partial) this.beginPartialHandoff(rendered.durationSeconds);
      addLog("debug", "Local SID seek served from the pre-render cache", {
        service: "local-sid",
        seconds: target,
      });
      this.pump();
      return;
    }

    // Nothing cached can answer this one yet. Before falling back to a worker seek — which re-renders
    // the tune from the start with the audio gated shut, fifteen to twenty seconds of silence measured
    // on a Pixel 4 — check whether the pre-render is already on its way there. It usually is: it began
    // when the tune did, and it is rendering exactly the audio this seek needs. Racing it does the same
    // work twice and plays nothing while both run.
    this.cached = null;
    this.cachedCursor = 0;
    if (this.prerenderFraction !== null && this.prerenderKey === this.currentKey) {
      this.pendingSeek = {
        targetSeconds: target,
        renderedAtRequestSeconds: rendered?.durationSeconds ?? 0,
        audibleAtRequestSeconds: audibleAtRequest,
        generation: epoch,
        trackInstanceId: this.trackInstanceId,
      };
      // Held at the target, not drifting on from where it was. Letting playback carry on meant the
      // listener heard the old position while the bar showed the new one, which is worse than a pause:
      // there is no way to tell whether the drag did anything. Silence with a visibly advancing
      // pre-render fill says exactly what is happening.
      this.audio?.flush?.();
      addLog("debug", "Local SID seek waiting for the pre-render to reach it", {
        service: "local-sid",
        seconds: target,
      });
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
      // Bounded, because leaving this set is not a lost seek but lost audio: while it is set every
      // chunk is discarded, so a reply that never comes would silence the tune indefinitely. Give
      // up on the reply and reopen the gate rather than wait for it forever — the worst case is a
      // seek that does not land, which is a great deal better than a track that plays nothing.
      const timer = setTimeout(() => {
        if (this.seekPending?.id !== id) return;
        this.seekPending = null;
        addLog("warn", "Local SID seek was not acknowledged; reopening the audio gate", {
          service: "local-sid",
          seconds: target,
        });
        resolve();
        this.pump();
      }, SEEK_ACK_TIMEOUT_MS);
      this.seekPending = {
        id,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      this.worker?.postMessage({ type: "seek", id, positionSeconds: target });
    });

    // A newer seek landed while this one was in flight; that one owns the state.
    if (epoch !== this.seekEpoch) return;
    this.pump();
  }

  /**
   * Is this pending seek still the one the listener is waiting for?
   *
   * Two ways it can stop being: the track was replaced (Next, Stop, a station change, a route or
   * engine change — all of which open or tear down a tune, and all of which bump the instance), or
   * a newer seek was accepted (the drag moved again, or the target came inside coverage). Either
   * way the completion that is arriving now belongs to nobody, and applying it would move playback
   * to a position nobody currently wants.
   */
  private isStalePendingSeek(pending: PendingSeekState): boolean {
    return pending.trackInstanceId !== this.trackInstanceId || pending.generation !== this.seekEpoch;
  }

  /**
   * The seek still being waited for, or null — including when what is stored belongs to a tune that
   * has been left behind.
   *
   * Every gating read goes through here rather than touching the field, because a leftover is not
   * harmless. A pending seek stops `pump()` asking for chunks, makes the chunk and end handlers
   * discard what does arrive, and stands the stall watchdog down. Left set across a skip, those
   * three together are a tune that plays the start-up buffer already scheduled — about half a
   * second — and is then silent for good, with nothing watching to notice and nothing to advance
   * the playlist. Stop and Play cleared it, because `stop()` resets the field, which is exactly the
   * shape the bug was reported in.
   *
   * Self-clearing rather than merely reporting: once the tune or the seek epoch has moved on there
   * is no reader who wants the old value, and leaving it for the next caller to trip over is what
   * made a single missing reset in `play()` reachable from eight places.
   */
  private get activePendingSeek(): PendingSeekState | null {
    const pending = this.pendingSeek;
    if (!pending) return null;
    if (this.isStalePendingSeek(pending)) {
      this.pendingSeek = null;
      return null;
    }
    return pending;
  }

  /**
   * Settle a seek that was still waiting when the pre-render finished.
   *
   * In practice the target is past the end of the tune whenever this runs — a drag into the closing
   * seconds. Every chunk of a pre-render is delivered as it is produced, so a target inside the
   * finished render was already served by the chunk that reached it. The covering branch is kept as
   * a safety net for a renderer that ever coalesces its tail into the completion message, and it
   * decides from the buffer's own length rather than the reported duration: if the two ever
   * disagree, only the samples that exist can actually be played.
   *
   * The other case is the end of the track, reported once so the playlist moves on instead of
   * sitting silent on a tune that has nothing left to render.
   */
  private resolvePendingSeekAgainstCompletedRender(
    pcm: Int16Array,
    sampleRate: number,
    channels: number,
    seconds: number,
  ): void {
    const pending = this.pendingSeek;
    if (!pending) return;
    this.pendingSeek = null;
    if (this.isStalePendingSeek(pending)) return;
    const coveredSeconds = pcm.length / Math.max(1, channels) / Math.max(1, sampleRate);
    if (pcm.length > 0 && pending.targetSeconds < coveredSeconds) {
      this.cached = { partial: false, pcm, sampleRate, channels, durationSeconds: seconds };
      this.cachedCursor = Math.min(pcm.length, Math.floor(pending.targetSeconds * sampleRate) * channels);
      addLog("debug", "Local SID awaited seek served by the completed pre-render", {
        service: "local-sid",
        seconds: pending.targetSeconds,
      });
      this.pump();
      return;
    }
    addLog("debug", "Local SID awaited seek landed at or past the end of the tune", {
      service: "local-sid",
      seconds: pending.targetSeconds,
      renderedSeconds: seconds,
    });
    this.endReceived = true;
    this.maybeFireEnded();
  }

  /** Begin supervising liveness. Idempotent; a running watchdog is left alone. */
  private startWatchdog(): void {
    this.lastAudioAtMs = Date.now();
    if (this.watchdogTimer !== null) return;
    this.watchdogTimer = setInterval(() => {
      // Published from the engine's own cadence, not from whoever happens to be asking for stats.
      // It used to ride along inside getStats(), whose only regular caller is the Play page's
      // interval — and that interval is removed on tab navigation while this engine deliberately
      // keeps playing. So a listener who left Play for Live View froze the governor on the last
      // sample it happened to see: later starvation could not demote video, and an old low-buffer
      // reading could keep it demoted for good. This timer lives as long as the tune does.
      this.publishAudioHealth();
      this.checkLiveness();
    }, WATCHDOG_TICK_MS);
  }

  /**
   * Tell the A/V governor how this engine's audio is doing.
   *
   * The governor sheds video to protect audio, and it can only do that for a tune rendered here if it
   * is told about it — a locally-rendered tune was invisible to it, and Live View kept painting at full
   * rate while this engine starved. Measured with the timing barcode: one bad note in 102 alone,
   * eleven in forty seconds with video also running.
   */
  private publishAudioHealth(stats?: { bufferedSeconds?: number; underruns?: number }): void {
    const source = stats ?? this.scheduler?.getStats();
    reportLocalAudioHealth({
      active: this.scheduler !== null && !this.paused,
      bufferedMs: (source?.bufferedSeconds ?? 0) * 1000,
      underruns: Math.max(source?.underruns ?? 0, this.audio?.audioUnderruns?.() ?? 0),
    });
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
   *
   * An outstanding open or seek is quiet for a reason too, and a reason this timer is the wrong
   * judge of. Both are single calls into the one stateful WASM engine that take as long as the
   * work takes: a seek renders and discards everything between here and the target, so seeking a
   * minute into a tune is a minute of emulation with no message in the meantime, and it queues
   * behind whatever renders are already in flight. Five seconds of silence is normal for both, and
   * both already have a bound of their own — the open timeout and the seek acknowledgement — so
   * whichever is outstanding owns the failure. Judging them here as well is what turned a healthy
   * scrub into "playback stalled": a hold-to-seek posts a seek every 350 ms, each one empties the
   * buffer, and five seconds in the watchdog killed a worker that was doing exactly what was asked.
   */
  private checkLiveness(): void {
    if (!this.scheduler || this.endReceived || this.paused || this.stallRecoveryInFlight) return;
    if (this.openPending || this.seekPending) return;
    if (this.activePendingSeek !== null) return;
    // Waiting for the pre-render to reach a seek target is quiet for a reason too, and this timer is
    // the wrong judge of it: no worker call is outstanding, the buffer is deliberately empty, and the
    // wait lasts exactly as long as the rendering does — which for a position deep into a tune is far
    // longer than the stall timeout. Killing the worker here would restart the very render being
    // waited on, and the progress bar is already telling the listener what is happening.
    // Silence that the listener did not ask for.
    //
    // Everything above this line asks whether audio is being *produced*. This asks whether any of
    // it can be *heard*, which is the thing the listener actually cares about and the one condition
    // none of the other counters can see: a tune rendering a flat line keeps the buffer full, the
    // frames flowing and the clock advancing, and sounds like nothing at all. Muting is excluded
    // because a muted tune is silent on purpose — that is the listener's desired state, and this
    // exists to restore theirs, not to override it.
    //
    // The recovery is the same one a stall gets: re-open the tune once, and if it happens again let
    // the playlist move on. That keeps one mechanism rather than two.
    if (!this.muted && this.volume > 0 && this.audio?.isSilentFault?.()) {
      addErrorLog("Local SID playback is silent", {
        service: "local-sid",
        recoverable: !this.stallRecoveryUsed,
      });
      this.audio.resetSilence?.();
      void this.recoverFromStall();
      return;
    }
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
      // Set when a lead-in runs out, so the loop below falls through to live rendering rather than
      // returning. Returning here was silence: the pump exited without asking the worker for
      // anything, and nothing woke it again — a warmed tune played its opening and stopped.
      let handedOff = false;
      while (this.scheduler.bufferedSeconds() < this.targetBufferSeconds) {
        if (this.cachedCursor >= pcm.length) {
          if (this.followingPrerender) {
            // Momentarily caught up with a render that is still producing. The next chunk extends
            // this buffer and pumps again, so there is nothing to do but wait for it — and nothing
            // to hand off to, because the live renderer is at the position this seek left behind.
            return;
          }
          if (this.cached.partial) {
            // Only the opening was cached. The rest is rendered live from the seam, which the worker
            // was sent to when playback began. Treating this as the end would cut the song off.
            this.cached = null;
            this.cachedCursor = 0;
            handedOff = true;
            break;
          }
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
      if (!handedOff) return;
    }
    if (!this.worker) return;
    // Nothing live is wanted while a seek waits on the pre-render. The chunks would be discarded on
    // arrival (they are the old position), so asking for them only spends the CPU that the
    // pre-render — the thread the listener is actually waiting for — needs to finish. Measured on a
    // Pixel 4, the two renderers competing is a material part of how long that wait lasts.
    if (this.activePendingSeek) return;
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
    // Since the last seek, not since the tune began. `chunksEnded` is zeroed by a seek and the
    // sources a seek silences never report, so comparing against the session total meant a tune that
    // had been seeked into could never satisfy this — it played to the end of its audio and then sat
    // there, silent and still "playing", until the songlength ran out.
    const scheduled = this.scheduler.chunksScheduledSinceReset();
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
    // Publish the engine's health where the Live View governor can see it. It already sheds video to
    // protect audio — that is what the priority order is for — but it could only see the MIRROR's
    // audio, so a tune rendered here was invisible and Live View kept painting at full rate while
    // this engine starved. Measured with the timing barcode: one bad note in 102 alone, eleven in
    // forty seconds with video also running.
    this.publishAudioHealth(stats ?? undefined);
    return {
      renderMsPerSec: this.totalRenderedSeconds > 0 ? this.totalRenderMs / this.totalRenderedSeconds : 0,
      renderMsPerSecP99: this.renderRateP99(),
      peakRenderMsPerSec: this.peakRenderMsPerSec,
      audioUnderruns: Math.max(stats?.underruns ?? 0, this.audio?.audioUnderruns?.() ?? 0),
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

  /**
   * The level and mute state on-device playback is currently using.
   *
   * The engine outlives any one mount of the Play page — it is a process-wide singleton — so it, and
   * not the page, is where the listener's choice actually persists. The page reads these on mount so
   * the slider and the speaker button come up showing what is really being played, rather than a
   * default that disagrees with the sound.
   */
  getVolume(): number {
    return this.volume;
  }

  getMuted(): boolean {
    return this.muted;
  }

  /** A fully-rendered tune, when this one has been cached. */
  getRenderedTune(key: string): RenderedTune | null {
    return this.renderCache.get(key);
  }

  /**
   * Send the live renderer to where the cached opening ends, while that opening is still playing.
   *
   * Seeking is not free — libsidplayfp cannot rewind, so it re-renders from the start to get there —
   * which is precisely why it is started early rather than when the buffer runs out.
   */
  private beginPartialHandoff(seconds: number): void {
    if (!this.worker || seconds <= 0) return;
    this.seekEpoch += 1;
    const id = this.nextId;
    this.nextId += 1;
    // Hand the slot over rather than overwrite it: `seekPending` gates chunk delivery, so a leaked
    // entry silences the tune. See the comment on the interactive seek path.
    this.seekPending?.resolve();
    // Bounded for the same reason the interactive seek is: while `seekPending` is set every rendered
    // chunk is discarded, so a reply that never arrives would silence the rest of the tune. Giving up
    // on the reply reopens the gate; the worst case is playing on from wherever the worker actually
    // is, which is a great deal better than playing nothing.
    const timer = setTimeout(() => {
      if (this.seekPending?.id !== id) return;
      this.seekPending = null;
      addLog("warn", "Local SID lead-in hand-off was not acknowledged; resuming anyway", {
        service: "local-sid",
        seconds,
      });
      this.pump();
    }, SEEK_ACK_TIMEOUT_MS);
    this.seekPending = {
      id,
      resolve: () => {
        clearTimeout(timer);
        this.pump();
      },
    };
    this.worker.postMessage({ type: "seek", id, positionSeconds: seconds });
  }

  /**
   * Render the opening of a tune the listener has not asked for yet.
   *
   * The next and previous tracks are warmed so that skipping to one starts from memory instead of
   * from a cold renderer. Only the opening: that is all that is needed to cover the gap before the
   * buffer is ahead, and caching whole tunes at 192 KB per second would cost far more memory than
   * the problem is worth.
   */
  warmLeadIn(key: string, sidBytes: ArrayBuffer, songIndex: number, seconds: number): void {
    if (this.renderCache.has(key) || seconds <= 0) return;
    const roms = loadStoredRoms();
    if (!roms.kernal || !roms.basic) return;
    // One at a time on this thread, but never behind the playing tune's render — that is the point of
    // having a second thread. A warm still in flight is left alone rather than cancelled: the listener
    // is more likely to skip forwards, which is warmed first.
    if (this.warmKey !== null) {
      this.pendingWarms.set(key, { sidBytes, songIndex, seconds });
      return;
    }
    this.warmId += 1;
    this.warmKey = key;
    this.warmAccumulated = EMPTY_PCM;
    this.ensureWarmWorker().postMessage(
      {
        type: "prerender",
        id: this.warmId,
        sidBytes,
        songIndex,
        seconds,
        sampleRate: this.requestedSampleRate,
        roms: { kernal: roms.kernal.slice().buffer, basic: roms.basic.slice().buffer },
        sidModel: toEngineSidModel(resolveLocalSidModel()),
      } as LocalSidMainToWorker,
      [sidBytes],
    );
  }

  /** Start the next queued lead-in, now that the warm thread is free. */
  private drainPendingWarms(): void {
    const next = this.pendingWarms.entries().next();
    if (next.done) return;
    const [key, request] = next.value;
    this.pendingWarms.delete(key);
    this.warmLeadIn(key, request.sidBytes, request.songIndex, request.seconds);
  }

  /** The lead-in renderer, created on first use. Its failures never affect playback. */
  /**
   * Which emulation to render with.
   *
   * The listener's choice, unless this device has been measured unable to keep up with the accurate
   * one — at or below real time no amount of buffering helps, because the renderer can never get
   * ahead. SIDLite does not sound the same, so this is a fallback rather than a preference; it is
   * taken because a tune that pauses is worse than a tune that sounds a little different.
   */
  private chosenEmulation(): SidEmulationEngine {
    const preferred = effectiveSidEmulationEngine(hasCompleteRomSet());
    if (preferred === "sidlite" || accurateEngineViable()) return preferred;
    addLog("warn", "Falling back to SIDLite: this device cannot render reSIDfp in real time", {
      service: "local-sid",
      renderRatio: +renderRatio().toFixed(2),
    });
    return "sidlite";
  }

  private ensureWarmWorker(): LocalSidWorkerLike {
    if (!this.warmWorker) {
      this.warmWorker = this.workerFactory();
      this.warmWorker.addEventListener("message", (event: MessageEvent<LocalSidWorkerToMain>) =>
        this.onWarmMessage(event.data),
      );
      this.warmWorker.addEventListener("error", (event: { message?: string }) => {
        addLog("warn", "Local SID lead-in renderer failed", { service: "local-sid", error: event.message });
        this.warmWorker = null;
        this.warmKey = null;
      });
      this.warmWorker.addEventListener("messageerror", () => {
        this.warmWorker = null;
        this.warmKey = null;
      });
      this.warmWorker.postMessage({
        type: "load",
        engine: effectiveSidEmulationEngine(hasCompleteRomSet()),
      } as LocalSidMainToWorker);
    }
    return this.warmWorker;
  }

  /**
   * Replies from the lead-in renderer.
   *
   * Handled apart from the playback and pre-render traffic so a warm can never be mistaken for either
   * — the ids are independent, and a warm must not touch what is playing.
   */
  private onWarmMessage(message: LocalSidWorkerToMain): void {
    if (message.type === "prerender-chunk") {
      if (message.id !== this.warmId || !this.warmKey) return;
      const grown = new Int16Array(this.warmAccumulated.length + message.pcm.length);
      grown.set(this.warmAccumulated, 0);
      grown.set(message.pcm, this.warmAccumulated.length);
      this.warmAccumulated = grown;
      return;
    }
    if (message.type === "prerendered") {
      if (message.id !== this.warmId || !this.warmKey) return;
      const key = this.warmKey;
      const pcm = this.warmAccumulated;
      this.warmKey = null;
      this.warmAccumulated = EMPTY_PCM;
      if (pcm.length > 0) {
        // Always a partial: it is only the opening, so running off its end has to hand over to live
        // rendering rather than end the tune.
        this.renderCache.set(key, {
          partial: true,
          pcm,
          sampleRate: message.sampleRate,
          channels: message.channels,
          durationSeconds: message.seconds,
        });
        addLog("debug", "Local SID lead-in warmed", {
          service: "local-sid",
          key,
          seconds: Math.round(message.seconds),
          cachedTunes: this.renderCache.size,
        });
      }
      this.drainPendingWarms();
      return;
    }
    if (message.type === "error" && message.id === this.warmId) {
      addLog("debug", "Local SID lead-in warm failed", { service: "local-sid", error: message.message });
      this.warmKey = null;
      this.warmAccumulated = EMPTY_PCM;
      this.drainPendingWarms();
    }
  }

  /**
   * Internals a HIL session needs when playback stalls.
   *
   * `seekPending` is the one that matters: while it is set every rendered chunk is discarded, so a
   * seek whose acknowledgement never arrives silences the rest of the tune. That is not visible from
   * the sink's counters, which is why guessing at it cost several rounds.
   */
  debugState(): Record<string, unknown> {
    return {
      seekPending: this.seekPending?.id ?? null,
      inFlightRenders: this.inFlightRenders,
      endReceived: this.endReceived,
      cached: this.cached ? { partial: Boolean(this.cached.partial), seconds: this.cached.durationSeconds } : null,
      cachedCursor: this.cachedCursor,
      followingPrerender: this.followingPrerender,
      currentKey: this.currentKey,
      pendingSeek: this.pendingSeek,
      trackInstanceId: this.trackInstanceId,
      prerenderFraction: this.prerenderFraction,
      pendingWarms: this.pendingWarms.size,
      cachedTunes: this.renderCache.size,
      scheduledAhead: this.scheduler?.bufferedSeconds() ?? null,
      // What the tune's end is waiting for. `maybeFireEnded` only fires once every scheduled source
      // has reported back, so a tune that has run out of audio but never advances is telling you
      // these two disagree — which is invisible from any other counter.
      chunksScheduled: this.scheduler?.getStats().chunksScheduled ?? null,
      chunksEnded: this.chunksEnded,
      endedFired: this.endedFired,
      cachedRemaining: this.cached ? this.cached.pcm.length - this.cachedCursor : null,
    };
  }

  /**
   * The position playback is waiting to reach, in seconds, or null when it is not waiting.
   *
   * Non-null means a seek landed past what is rendered, so playback is holding until the pre-render
   * gets there. Surfaced because a listener must never be left guessing whether a drag did anything.
   */
  getAwaitedSeekSeconds(): number | null {
    return this.activePendingSeek?.targetSeconds ?? null;
  }

  /**
   * The whole pending-seek record, or null when nothing is pending.
   *
   * The UI needs more than the target to say anything determinate: the render head as it stood when
   * the target was accepted is the denominator of the preparation progress, and the last audible
   * position is where the elapsed clock must sit while the engine holds. Returned as a copy so a
   * caller holding on to it cannot see the engine's own record change underneath them.
   */
  getPendingSeek(): PendingSeekState | null {
    const pending = this.activePendingSeek;
    return pending ? { ...pending } : null;
  }

  /**
   * Is a seek of any kind still being worked on?
   *
   * Two different waits look identical from outside — the playhead stops and nothing sounds — and
   * both are legitimate. One is waiting for the pre-render to reach the target ({@link pendingSeek},
   * which the progress bar reports). The other is the worker re-rendering the tune to get there,
   * which is silent and unreported but just as deliberate, and takes fifteen to twenty seconds on a
   * Pixel 4.
   *
   * Anything that treats a motionless playhead as a fault has to ask this first. The auto-advance
   * deadline is the one that matters: left to run down through a slow seek it would skip the track
   * the listener is waiting to hear.
   */
  isSeeking(): boolean {
    return this.seekPending !== null || this.activePendingSeek !== null;
  }

  /**
   * Seconds of the tune now playing that are already rendered, or null when none are.
   *
   * Drives the progress bar's pre-render fill: it is exactly how far a seek can land instantly.
   */
  getRenderedSeconds(): number | null {
    if (!this.currentKey) return null;
    const entry = this.renderCache.get(this.currentKey);
    return entry ? entry.durationSeconds : null;
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
    this.prerenderAccumulated = EMPTY_PCM;
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
        sidModel: toEngineSidModel(resolveLocalSidModel()),
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
    // Stop asking the mirror to protect audio that is no longer playing, or Live View would stay
    // demoted for the rest of the session.
    clearLocalAudioHealth();
    releaseAudioOwnership(this);
    // Reopen the seek gate. `seekPending` suppresses every "chunk" and "end" so audio rendered for
    // the position we just left is never scheduled, and it is cleared only by a `seeked` reply whose
    // id still matches. A reply that is lost — or superseded by a newer seek — therefore left it
    // shut, and because a stop never reopened it the silence outlived the tune: the NEXT tune's
    // chunks were discarded too, and re-opening in a fresh worker could not help either, because the
    // gate is engine state and not the worker's. Scrubbing posts a seek every 350 ms, so this was
    // easy to meet, and it is the whole of the "local SID playback stalled" report.
    this.seekPending?.resolve();
    this.seekPending = null;
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
    if (outgoing && fadeMs > 0) {
      // Taken now, while the outgoing sink still holds it: it stops writing the moment the next
      // tune's first slice reaches the track, and this is the audio that has to sound underneath.
      this.crossfadeTail = outgoing.takeCrossfadeTail?.(fadeMs / 1000) ?? null;
      this.crossfadeSeconds = fadeMs / 1000;
    }
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
    this.followingPrerender = false;
    this.currentKey = null;
    // Stop, Next, Previous, a station change, a route change and an engine change all come through
    // here, and every one of them is the listener saying they no longer want the position they were
    // waiting for. Leaving it set outlived the tune: the progress bar kept showing a target for a
    // track that had gone, and the stall watchdog stayed disabled for the next one.
    this.pendingSeek = null;
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
