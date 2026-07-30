/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer A/V Mirror — the app-wide **shared** Live View session
 * (docs/plans/content-explorer/06-av-mirror-ux.md).
 *
 * There is exactly one audio stream and one video stream for the whole app. Every
 * surface (Home, Remote Input, Play, Disks) observes and controls THIS session, so
 * the mirror is never duplicated: starting audio on Home and opening Remote Input
 * show the same live stream. Video frames are broadcast, so multiple canvases (a
 * Home "check" preview and the Remote Input preview) render the one stream.
 */

import { C64API, getC64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { Capacitor } from "@capacitor/core";

import { isNativePlatform } from "@/lib/native/platform";
import { StreamUdp } from "@/lib/native/streamUdp";
import {
  loadStreamAudioPort,
  loadStreamNativeAudio,
  loadStreamNetworkBufferMs,
  loadStreamInputPriority,
  loadStreamNativeVideoAssembly,
  loadStreamVideoFrameRateMode,
  loadStreamVideoPort,
  loadStreamAudioRoute,
  type StreamAudioRoute,
  type StreamVideoFrameRateMode,
} from "@/lib/config/appSettings";
import { getDeveloperModeEnabled } from "@/lib/config/developerModeStore";
import { resolveVideoStartAction, shouldReturnAudioToWifi, shouldUseWifiForAudio } from "./audioRoute";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";
import { NativeAudioSink } from "./audioNativeSink";
import { AudioMirrorController, type AudioMirrorSignals, type AudioMirrorState } from "./audioMirrorController";
import { VideoMirrorController, type VideoMirrorState } from "./videoMirrorController";
import { readLocalAudioHealth } from "@/lib/streams/localAudioHealthSignal";
import { StreamGovernor, type FrameRateMode, type GovernorState, type GovernorTransition } from "./streamGovernor";
import { StreamTelemetry, type TelemetryBucket, type TelemetrySessionSummary } from "./streamTelemetry";
import { onInputActivity } from "./inputActivitySignal";
import { claimPhoneAudio, releasePhoneAudio } from "@/lib/audio/phoneAudioOwnership";
import type { VideoStandard } from "./vicDecode";
import type { AudioMirrorPlayer } from "./audioPlayer";

export interface AvMirrorSnapshot {
  audio: { state: AudioMirrorState; droppedPackets: number; error: string | null };
  video: {
    state: VideoMirrorState;
    fps: number;
    droppedPackets: number;
    framesLost: number;
    standard: VideoStandard;
    error: string | null;
  };
}

export type AvMirrorFrameHandler = (frame: Uint8Array, height: number, arrivalMs: number) => void;
export type AvMirrorAudioHandler = (samples: Int16Array, arrivalMs: number) => void;
export type AvMirrorListener = (snapshot: AvMirrorSnapshot) => void;

/**
 * Live Stats snapshot (governor + telemetry) — a SEPARATE channel from {@link AvMirrorSnapshot} so
 * existing surfaces keep their lightweight state/health payload and only the Stats screen pays for
 * the richer view. Produced on the low-rate {@link AvMirrorSession.tick} (~4 Hz).
 */
export interface AvStatsSnapshot {
  governor: GovernorState;
  transitions: readonly GovernorTransition[];
  summary: TelemetrySessionSummary;
  /** Instantaneous values captured at the last tick. */
  live: {
    fps: number;
    audioBufferMs: number;
    audioUnderruns: number;
    audioConcealed: number;
    renderResidenceMs: number;
    maxResidenceMs: number;
    presented: number;
    decimated: number;
    backlogReplacements: number;
    completeFrames: number;
    partialConcealed: number;
    repeatedFrames: number;
    framesLost: number;
    droppedPackets: number;
    standard: VideoStandard;
  };
}

export type AvStatsListener = (snapshot: AvStatsSnapshot) => void;

const INITIAL: AvMirrorSnapshot = {
  audio: { state: "off", droppedPackets: 0, error: null },
  video: { state: "off", fps: 0, droppedPackets: 0, framesLost: 0, standard: "PAL", error: null },
};

const isLiveState = (state: AudioMirrorState | VideoMirrorState) => state === "connecting" || state === "live";

/**
 * Which audio buffer the governor is judged on, and the nominal depth that describes it.
 *
 * Whichever path is closer to running dry is the one to protect — and the nominal has to come from
 * THAT path, or the governor scales its health thresholds for one buffer while reading another. A
 * reported nominal moves the "critical" bar from 25 ms to 0, because a small native buffer is expected
 * rather than starvation; so dropping it while feeding the mirror's shallow depth is exactly how a
 * healthy native buffer gets read as starving.
 *
 * Not academic: the two depths differ by three orders of magnitude by design. On-device playback holds
 * seconds so a busy JS thread cannot starve it; the native mirror sink holds tens of milliseconds so
 * input stays in step. The minimum is therefore almost always the mirror's — which is precisely the
 * case where the nominal used to be dropped.
 *
 * Exported so a test can exercise this decision directly. It was previously inline, and the tests for
 * it reimplemented the arithmetic, which left them green against the unfixed wiring.
 */
export const chooseAudioBufferSignals = (input: {
  localActive: boolean;
  localBufferedMs: number;
  mirrorLive: boolean;
  mirrorBufferedMs: number;
  mirrorNominalBufferMs?: number;
}): { audioBufferMs: number; audioNominalBufferMs?: number } => {
  const mirrorIsTighter = !input.localActive || (input.mirrorLive && input.mirrorBufferedMs <= input.localBufferedMs);
  return mirrorIsTighter
    ? { audioBufferMs: input.mirrorBufferedMs, audioNominalBufferMs: input.mirrorNominalBufferMs }
    : { audioBufferMs: input.localBufferedMs, audioNominalBufferMs: undefined };
};

export interface AvMirrorSessionDeps {
  startStream?: (name: "audio" | "video", destination: string, options?: { wifi?: boolean }) => Promise<unknown>;
  stopStream?: (name: "audio" | "video") => Promise<unknown>;
  createAudioReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createVideoReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createPlayer?: () => AudioMirrorPlayer;
  videoFrameThrottle?: number;
  now?: () => number;
  /** Present scheduler for the video mirror (defaults to requestAnimationFrame where it exists). */
  schedulePresent?: (present: () => void) => void;
}

/**
 * Present on the next animation frame, so the video mirror's depth-one present queue can actually
 * coalesce.
 *
 * `VideoMirrorController` is built around a drop-late queue: a frame that arrives while another is
 * still waiting REPLACES it, so only the newest survives. That only works if presentation is
 * deferred. With the controller's synchronous default every arriving frame is decoded and drawn
 * inline, `pending` is consumed before the next frame can supersede it, and the queue never drops
 * anything — `backlogReplacements` is structurally always 0.
 *
 * That is not academic. Capacitor queues `videoframe` events across the bridge while the JS thread
 * is busy (the on-device SID engine, a GC pause, a heavy route), so a stall is followed by a burst
 * of every buffered frame. Measured on a Pixel 4 against a c64u: a 2.5 s stall made the mirror
 * present at 174 fps from a 50 Hz source — ~125 stale frames decoded and painted, one after another,
 * extending the very stall that caused them. Deferring to rAF collapses that burst to the single
 * newest frame, which is the only one anybody can see.
 */
const rafPresentScheduler = (): ((present: () => void) => void) | undefined =>
  typeof requestAnimationFrame === "function" ? (present) => void requestAnimationFrame(() => present()) : undefined;

const FRAME_RATE_MODE: Record<StreamVideoFrameRateMode, FrameRateMode> = {
  auto: "auto",
  "100": "100",
  "50": "50",
  "25": "25",
};

/**
 * How long after the last input event the user is still considered "actively driving" — the video
 * mirror stays shed for this tail so a burst of joystick movements doesn't flicker the cadence, then
 * video ramps straight back up. ~350 ms covers the gap between a governor tick (~250 ms) and the next
 * input while staying short enough that the picture recovers the instant the user pauses.
 */
export const INPUT_PRIORITY_TAIL_MS = 350;

/**
 * The video keep-fraction cap WHILE input is active. Low enough to free the JS thread + native
 * encoder for the input path (instant joystick response), high enough to keep visible feedback of
 * what the input is doing. ~0.2 ≈ every 5th PAL frame (~10 fps) — the user still sees their move
 * land while the CPU is handed to input. Video returns to the governor's full target once input idles.
 */
export const DEFAULT_INPUT_PRIORITY_FRACTION = 0.2;

/** Shown on the video pane when the `wifi` audio policy keeps audio on Wi‑Fi, which video can't join. */
export const WIFI_AUDIO_BLOCKS_VIDEO =
  "Audio is streaming over Wi‑Fi, which can't run together with video. Switch the audio route to Ethernet or Dynamic in Settings, or stop the audio, to watch.";

export class AvMirrorSession {
  private snapshot: AvMirrorSnapshot = INITIAL;
  private readonly listeners = new Set<AvMirrorListener>();
  private readonly frameListeners = new Set<AvMirrorFrameHandler>();
  private readonly audioListeners = new Set<AvMirrorAudioHandler>();
  /** Whether the native receiver is currently forwarding audio packets to JS for analysis. */
  private nativeAudioAnalysis = false;
  private readonly statsListeners = new Set<AvStatsListener>();
  private latestFrame: { frame: Uint8Array; height: number; arrivalMs: number } | null = null;
  private readonly audio: AudioMirrorController;
  private readonly video: VideoMirrorController;
  private readonly governor: StreamGovernor;
  private readonly telemetry = new StreamTelemetry();
  private readonly now: () => number;
  /** Last observed cumulative player-underrun count, for per-tick delta. */
  private lastAudioUnderruns = 0;
  private lastLocalAudioUnderruns = 0;
  /** Wall time (ms) until which the user is treated as actively driving the C64 → video stays shed. */
  private inputActiveUntilMs = 0;
  /** Video keep-fraction cap applied while input is active. */
  private inputPriorityFraction = DEFAULT_INPUT_PRIORITY_FRACTION;
  /** Whether input-priority shedding is enabled (Settings; read at session start). Default on. */
  private inputPriorityEnabled = true;
  /** True when starting video moved a Wi‑Fi audio stream onto Ethernet (dynamic policy) — so it can move back on video stop. */
  private audioForcedToEthernet = false;
  /** Serializes audio/video start/stop so a route conversion (stop+start) can't interleave with another toggle. */
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(deps: AvMirrorSessionDeps = {}) {
    const startStream =
      deps.startStream ?? ((name, destination, options) => getC64API().startStream(name, destination, options));
    const stopStream = deps.stopStream ?? ((name) => getC64API().stopStream(name));
    this.now = deps.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    // The stored frame-rate mode is applied when a session starts (see beginSessionIfIdle), NOT at
    // construction — the app-wide singleton is built at import time, before localStorage-backed
    // settings are safe to read under test, so reading here would couple every importer to the setting.
    this.governor = new StreamGovernor("auto");

    this.audio = new AudioMirrorController({
      startStream: (_name, destination, options) => startStream("audio", destination, options),
      stopStream: () => stopStream("audio"),
      onChange: (s) => this.update({ audio: { state: s.state, droppedPackets: s.droppedPackets, error: s.error } }),
      createReceiver:
        deps.createAudioReceiver ?? ((opts) => createStreamReceiver({ ...opts, port: loadStreamAudioPort() })),
      createPlayer: deps.createPlayer,
      // Native low-latency audio when the setting is on AND we're on a device with the plugin;
      // evaluated at start (not import) so the live setting wins. Returns null → WebAudio fallback.
      createNativeSink: (sampleRate) =>
        loadStreamNativeAudio() && isNativePlatform()
          ? new NativeAudioSink(sampleRate, undefined, loadStreamNetworkBufferMs())
          : null,
      renderAudioForAnalysis: (samples, arrivalMs) => this.emitAudio(samples, arrivalMs),
      // Who we EXPECT to hear from, and how to silence anyone else. The mirror's groups are
      // multicast and every Ultimate defaults to the same ones, so a machine left streaming by an
      // earlier session sends straight into ours.
      expectedSenderHost: () => getC64API().getDeviceHost(),
      stopStreamAt: (host, name) => new C64API(undefined, undefined, host).stopStream(name),
    });

    this.video = new VideoMirrorController({
      startStream: (_name, destination) => startStream("video", destination),
      stopStream: () => stopStream("video"),
      onChange: (s) =>
        this.update({
          video: {
            state: s.state,
            fps: s.fps,
            droppedPackets: s.droppedPackets,
            framesLost: s.framesLost,
            standard: s.standard,
            error: s.error,
          },
        }),
      createReceiver:
        deps.createVideoReceiver ??
        ((opts) =>
          createStreamReceiver({
            ...opts,
            port: loadStreamVideoPort(),
            nativeVideoAssembly: loadStreamNativeVideoAssembly(),
          })),
      renderFrame: (frame, height, arrivalMs) => this.emitFrame(frame, height, arrivalMs),
      // Start at the governor's effective divisor (from the saved frame-rate mode); the tick keeps it live.
      frameThrottle: deps.videoFrameThrottle ?? 1,
      now: deps.now,
      schedulePresent: deps.schedulePresent ?? rafPresentScheduler(),
    });
  }

  getSnapshot(): AvMirrorSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<AvMirrorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private emitFrame(frame: Uint8Array, height: number, arrivalMs: number) {
    this.latestFrame = { frame, height, arrivalMs };
    this.frameListeners.forEach((handler) => handler(frame, height, arrivalMs));
  }

  private emitAudio(samples: Int16Array, arrivalMs: number) {
    this.audioListeners.forEach((handler) => handler(samples, arrivalMs));
  }

  subscribe(listener: AvMirrorListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to decoded-ready video frames (a canvas surface). Replays the last frame. */
  subscribeFrames(handler: AvMirrorFrameHandler): () => void {
    this.frameListeners.add(handler);
    if (this.latestFrame) handler(this.latestFrame.frame, this.latestFrame.height, this.latestFrame.arrivalMs);
    return () => {
      this.frameListeners.delete(handler);
    };
  }

  /**
   * Subscribe to per-packet (~4 ms) decoded audio (interleaved Int16) with each packet's
   * wire-arrival timestamp — for the A/V sync analyzer. This is the RAW received stream (no
   * jitter-buffer reordering or loss concealment): the analyzer must measure the true stream,
   * so concealment fill can never be mistaken for a tone pop.
   */
  subscribeAudio(handler: AvMirrorAudioHandler): () => void {
    this.audioListeners.add(handler);
    this.syncNativeAudioAnalysis();
    return () => {
      this.audioListeners.delete(handler);
      this.syncNativeAudioAnalysis();
    };
  }

  /**
   * Keep the native receiver's audio bridge open exactly while someone is listening in JS.
   *
   * With the native sink playing, the receive thread stops emitting audio datagrams — that is the
   * point of the native path. But `subscribeAudio` exists for the analysers, and they measure the
   * received stream in JS, so without this an in-app measurement on Android would quietly grade
   * silence and report a fault that is really a missing feed.
   */
  private syncNativeAudioAnalysis(): void {
    const wanted = this.audioListeners.size > 0;
    if (wanted === this.nativeAudioAnalysis) return;
    this.nativeAudioAnalysis = wanted;
    // Android-only plugin: on web and iOS there is no native sink, so nothing is being bypassed.
    if (!isNativePlatform() || !Capacitor.isPluginAvailable("StreamUdp")) return;
    void StreamUdp.setAudioAnalysis({ enabled: wanted }).catch((error) => {
      addLog("warn", "Live View: could not toggle native audio analysis", {
        service: "streams",
        enabled: wanted,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** Subscribe to the low-rate Stats snapshot (governor + telemetry). Replays the current snapshot. */
  subscribeStats(handler: AvStatsListener): () => void {
    this.statsListeners.add(handler);
    handler(this.buildStatsSnapshot());
    return () => {
      this.statsListeners.delete(handler);
    };
  }

  /**
   * Advance the governor + telemetry one low-rate tick (the Stats hook drives this ~4 Hz while a
   * stream is live). Timer-free by design so the session stays a pure, unit-testable class: it reads
   * the current audio/video signals, lets the governor set the effective video divisor, records one
   * telemetry sample, and broadcasts the Stats snapshot. Cheap: a handful of reads + one push.
   */
  tick(nowMs: number = this.now()): void {
    const signals: AudioMirrorSignals =
      typeof this.audio.getSignals === "function"
        ? this.audio.getSignals()
        : { audioBufferMs: 0, audioUnderruns: 0, audioConcealed: 0, audioLostPackets: 0 };
    const video = this.video.getSnapshot();

    // On-device playback competes for the same main thread the video path paints on, and the governor
    // exists precisely to shed video for audio — it simply could not see this engine. Take whichever
    // audio is in more trouble: if a tune is rendering here and running thin, video must give way for
    // it exactly as it would for the mirror.
    const local = readLocalAudioHealth();
    const localUnderruns = Math.max(0, local.underruns - this.lastLocalAudioUnderruns);
    this.lastLocalAudioUnderruns = local.underruns;
    const audioActive = this.audioLive || local.active;
    const chosen = chooseAudioBufferSignals({
      localActive: local.active,
      localBufferedMs: local.bufferedMs,
      mirrorLive: this.audioLive,
      mirrorBufferedMs: signals.audioBufferMs,
      mirrorNominalBufferMs: signals.audioNominalBufferMs,
    });
    const audioBufferMs = chosen.audioBufferMs;

    const governor = this.governor.update(
      {
        audioBufferMs,
        // Native low-latency sink runs a smaller buffer; pass its nominal so the governor scales its
        // health thresholds and doesn't misread a healthy native buffer as starvation. Paired with the
        // buffer above: the nominal describes the same path the reading came from.
        audioNominalBufferMs: chosen.audioNominalBufferMs,
        // Feed the underruns SINCE the last tick as the demote trigger; the cumulative total goes to telemetry.
        audioUnderruns: Math.max(0, signals.audioUnderruns - this.lastAudioUnderruns) + localUnderruns,
        // Only let the audio buffer/underrun signals drive video when audio is actually playing —
        // a video-only mirror has no player (bufferedMs = 0) and must not be pegged to the floor.
        // On-device playback counts as audio playing, because it is.
        audioActive,
        videoQueueAgeMs: video.renderResidenceMs,
        frameProcessingP95Ms: undefined,
        localLatencyP99Ms: undefined,
      },
      nowMs,
    );
    this.lastAudioUnderruns = signals.audioUnderruns;
    // Input priority caps the governor's target while the user is actively driving the C64, so the
    // telemetry records the fraction the video path ACTUALLY runs at (not just the governor's target).
    const applied = this.effectiveVideoFraction(governor.effectiveFraction, nowMs);
    this.applyKeepFraction(applied);

    this.telemetry.record({
      tMs: nowMs,
      audioConcealed: signals.audioConcealed,
      audioLostPackets: signals.audioLostPackets,
      audioBufferMs: signals.audioBufferMs,
      audioUnderruns: signals.audioUnderruns,
      videoPresented: video.presented,
      videoDecimated: video.decimated,
      videoBacklogReplacements: video.backlogReplacements,
      videoFramesLost: video.framesLost,
      videoDroppedPackets: video.droppedPackets,
      renderResidenceMs: video.renderResidenceMs,
      fps: video.fps,
      effectiveFraction: applied,
      requestedMode: governor.requested,
    });
    this.emitStats();
  }

  /**
   * Signal that the user is actively driving the C64 (joystick/keyboard/mouse). Input ALWAYS takes
   * precedence over streaming throughput (spec priority: joystick > keyboard > audio > video): while
   * active, the video cadence is capped to {@link inputPriorityFraction} so the JS thread and the
   * native encoder are free for the input path, giving an INSTANT C64 response to a sudden joystick
   * movement even under a high-fps stream. Applied on the LEADING edge here — not only at the ~4 Hz
   * governor tick — so the shed is immediate; video ramps back up automatically once input goes idle
   * (after {@link INPUT_PRIORITY_TAIL_MS}). Cheap and idempotent: safe to call on every input event.
   */
  notifyInputActivity(nowMs: number = this.now()): void {
    if (!this.inputPriorityEnabled) return;
    const wasActive = nowMs < this.inputActiveUntilMs;
    this.inputActiveUntilMs = nowMs + INPUT_PRIORITY_TAIL_MS;
    // Only re-apply the cadence on the leading edge of an input burst (transition idle → active);
    // subsequent events just extend the tail, and the video is already shed.
    if (!wasActive && this.videoLive) {
      this.applyKeepFraction(this.effectiveVideoFraction(this.governor.state.effectiveFraction, nowMs));
    }
  }

  /** Enable/disable input priority and optionally override the active-cadence cap (tuning/tests). */
  setInputPriority(enabled: boolean, fraction?: number): void {
    this.inputPriorityEnabled = enabled;
    if (fraction !== undefined) this.inputPriorityFraction = Math.min(1, Math.max(0.01, fraction));
    if (!enabled) this.inputActiveUntilMs = 0;
  }

  /** The keep-fraction the video path should run at: the governor target, capped while input is active. */
  private effectiveVideoFraction(governorFraction: number, nowMs: number): number {
    const inputActive = this.inputPriorityEnabled && nowMs < this.inputActiveUntilMs;
    return inputActive ? Math.min(governorFraction, this.inputPriorityFraction) : governorFraction;
  }

  /** Set the requested Live View frame-rate mode (§11.1). Applies immediately + records the transition. */
  setFrameRateMode(mode: FrameRateMode, nowMs: number = this.now()): void {
    const state = this.governor.setRequested(mode, nowMs);
    this.applyKeepFraction(this.effectiveVideoFraction(state.effectiveFraction, nowMs));
    this.emitStats();
  }

  getStatsSnapshot(): AvStatsSnapshot {
    return this.buildStatsSnapshot();
  }

  /** History buckets for a Stats chart window (seconds). Computed on demand (Stats open only). */
  statsHistory(windowSec: number): TelemetryBucket[] {
    return this.telemetry.history(windowSec);
  }

  /** Diagnostic export (§12.4). Caller supplies app/device/settings meta + limitations. */
  exportDiagnostics(meta: Record<string, unknown> = {}): Record<string, unknown> {
    return this.telemetry.export({
      ...meta,
      governor: this.governor.state,
      governorTransitions: this.governor.getTransitions(),
    });
  }

  private buildStatsSnapshot(): AvStatsSnapshot {
    const video = this.video.getSnapshot();
    const signals: AudioMirrorSignals =
      typeof this.audio.getSignals === "function"
        ? this.audio.getSignals()
        : { audioBufferMs: 0, audioUnderruns: 0, audioConcealed: 0, audioLostPackets: 0 };
    return {
      governor: this.governor.state,
      transitions: this.governor.getTransitions(),
      summary: this.telemetry.summary(),
      live: {
        fps: video.fps,
        audioBufferMs: signals.audioBufferMs,
        audioUnderruns: signals.audioUnderruns,
        audioConcealed: signals.audioConcealed,
        renderResidenceMs: video.renderResidenceMs,
        maxResidenceMs: video.maxResidenceMs,
        presented: video.presented,
        decimated: video.decimated,
        backlogReplacements: video.backlogReplacements,
        completeFrames: video.completeFrames,
        partialConcealed: video.partialConcealed,
        repeatedFrames: video.repeatedFrames,
        framesLost: video.framesLost,
        droppedPackets: video.droppedPackets,
        standard: video.standard,
      },
    };
  }

  private emitStats(): void {
    if (this.statsListeners.size === 0) return;
    const snapshot = this.buildStatsSnapshot();
    this.statsListeners.forEach((listener) => listener(snapshot));
  }

  get audioLive(): boolean {
    return isLiveState(this.snapshot.audio.state);
  }

  get videoLive(): boolean {
    return isLiveState(this.snapshot.video.state);
  }

  /** Apply the effective cadence divisor to the video controller (guarded for mocked controllers in tests). */
  private applyKeepFraction(fraction: number): void {
    if (typeof this.video.setKeepFraction === "function") this.video.setKeepFraction(fraction);
  }

  /** Clear stale telemetry + governor pressure when a fresh session begins (§7.10), and apply the saved mode. */
  private beginSessionIfIdle(): void {
    if (this.audioLive || this.videoLive) return;
    this.telemetry.reset();
    this.governor.reset();
    this.lastAudioUnderruns = 0;
    this.inputActiveUntilMs = 0;
    // Read the input-priority preference now (deferred from construction, same as the frame-rate mode).
    this.inputPriorityEnabled = loadStreamInputPriority();
    // Apply the persisted user frame-rate mode now (deferred from construction). setRequested is a
    // no-op if it already matches, so restarts don't spam transitions.
    const stored = FRAME_RATE_MODE[loadStreamVideoFrameRateMode()];
    const state = this.governor.setRequested(stored, this.now());
    this.applyKeepFraction(state.effectiveFraction);
  }

  /**
   * The audio route in effect. The Wi‑Fi route (firmware PR #732) does not exist
   * in released firmware yet, so it is a **developer-mode-only** capability:
   * outside developer mode the route is always Ethernet, whatever is persisted.
   */
  private effectiveAudioRoute(): StreamAudioRoute {
    return getDeveloperModeEnabled() ? loadStreamAudioRoute() : "ethernet";
  }

  /** Run `op` after any in-flight transport op completes, so route conversions never interleave. */
  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(op, op);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  startAudio(): Promise<void> {
    return this.serialize(async () => {
      this.beginSessionIfIdle();
      // Take the speaker before opening the stream. The local SID engine can be
      // playing a tune here, and the C64's audio laid over the top of it is two
      // pieces of music at once with no way for the listener to tell which
      // control stops which. Claiming first means the tune is already silenced
      // by the time the first packet arrives.
      claimPhoneAudio("av-mirror", this, () => {
        void this.stopAudio().catch((error) => {
          // Not cosmetic: if the stop fails, the C64's audio keeps playing and
          // the local tune starts underneath it — the two-sounds-at-once
          // failure this registry exists to prevent.
          addLog("warn", "A/V mirror: stopping audio during eviction failed", {
            service: "streams",
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
      // Prefer Wi‑Fi for audio-only when the policy allows it (firmware wifi=true);
      // the controller falls back to Ethernet if Wi‑Fi isn't available.
      const wifi = shouldUseWifiForAudio({ policy: this.effectiveAudioRoute(), videoActive: this.videoLive });
      try {
        await this.audio.start({ wifi });
      } catch (error) {
        // Nothing is playing, so do not keep holding the speaker against a
        // local tune that could otherwise start.
        releasePhoneAudio(this);
        throw error;
      }
    });
  }

  stopAudio(): Promise<void> {
    return this.serialize(async () => {
      this.audioForcedToEthernet = false;
      releasePhoneAudio(this);
      await this.audio.stop();
    });
  }

  toggleAudio(): Promise<void> {
    return this.audioLive ? this.stopAudio() : this.startAudio();
  }

  startVideo(): Promise<void> {
    return this.serialize(async () => {
      // Wi‑Fi audio can't share a route with video. Depending on the policy, move
      // the audio to Ethernet first (dynamic) or refuse the video (wifi).
      const action = resolveVideoStartAction({
        policy: this.effectiveAudioRoute(),
        audioOnWifi: this.audio.isOnWifi(),
      });
      if (action === "blocked") {
        this.update({ video: { ...this.snapshot.video, error: WIFI_AUDIO_BLOCKS_VIDEO } });
        return;
      }
      if (action === "convert-audio-then-start") {
        await this.audio.stop();
        await this.audio.start({ wifi: false }); // Ethernet, so both share one route
        this.audioForcedToEthernet = true;
      }
      this.beginSessionIfIdle();
      await this.video.start();
    });
  }

  stopVideo(): Promise<void> {
    return this.serialize(async () => {
      await this.video.stop();
      this.latestFrame = null;
      // Dynamic policy: return audio to Wi‑Fi now that it is alone again, but only
      // if starting video is what moved it off Wi‑Fi in the first place.
      if (
        this.audioLive &&
        shouldReturnAudioToWifi({
          policy: this.effectiveAudioRoute(),
          audioForcedToEthernet: this.audioForcedToEthernet,
        })
      ) {
        this.audioForcedToEthernet = false;
        await this.audio.stop();
        await this.audio.start({ wifi: true });
      }
    });
  }

  toggleVideo(): Promise<void> {
    return this.videoLive ? this.stopVideo() : this.startVideo();
  }

  async stopAll(): Promise<void> {
    // allSettled so one failing stop cannot orphan the other, but a rejection must not be silently
    // swallowed (a failed stop can leave the device streaming / a receiver bound) — log each with
    // context so it stays diagnosable.
    const [audio, video] = await Promise.allSettled([this.stopAudio(), this.stopVideo()]);
    for (const [name, outcome] of [
      ["audio", audio],
      ["video", video],
    ] as const) {
      if (outcome.status === "rejected") {
        addLog("warn", `A/V mirror: failed to stop ${name} stream`, {
          error: (outcome.reason as Error)?.message ?? String(outcome.reason),
        });
      }
    }
  }
}

/** The app-wide shared session. */
export const avMirrorSession = new AvMirrorSession();

// Wire the shared session to the app-wide input-activity signal so any Remote Input event sheds the
// mirror instantly (see AvMirrorSession.notifyInputActivity). Kept OUT of the class so unit tests can
// construct isolated sessions without the global subscription; the singleton lives for the app's life.
onInputActivity((nowMs) => avMirrorSession.notifyInputActivity(nowMs));
