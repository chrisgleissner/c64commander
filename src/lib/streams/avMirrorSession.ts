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

import { getC64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import {
  loadStreamAudioPort,
  loadStreamNativeVideoAssembly,
  loadStreamVideoFrameRateMode,
  loadStreamVideoPort,
  type StreamVideoFrameRateMode,
} from "@/lib/config/appSettings";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";
import { AudioMirrorController, type AudioMirrorSignals, type AudioMirrorState } from "./audioMirrorController";
import { VideoMirrorController, type VideoMirrorState } from "./videoMirrorController";
import { StreamGovernor, type FrameRateMode, type GovernorState, type GovernorTransition } from "./streamGovernor";
import { StreamTelemetry, type TelemetryBucket, type TelemetrySessionSummary } from "./streamTelemetry";
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

export interface AvMirrorSessionDeps {
  startStream?: (name: "audio" | "video", destination: string) => Promise<unknown>;
  stopStream?: (name: "audio" | "video") => Promise<unknown>;
  createAudioReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createVideoReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createPlayer?: () => AudioMirrorPlayer;
  videoFrameThrottle?: number;
  now?: () => number;
}

const FRAME_RATE_MODE: Record<StreamVideoFrameRateMode, FrameRateMode> = {
  auto: "auto",
  "100": "100",
  "50": "50",
  "25": "25",
};

export class AvMirrorSession {
  private snapshot: AvMirrorSnapshot = INITIAL;
  private readonly listeners = new Set<AvMirrorListener>();
  private readonly frameListeners = new Set<AvMirrorFrameHandler>();
  private readonly audioListeners = new Set<AvMirrorAudioHandler>();
  private readonly statsListeners = new Set<AvStatsListener>();
  private latestFrame: { frame: Uint8Array; height: number; arrivalMs: number } | null = null;
  private readonly audio: AudioMirrorController;
  private readonly video: VideoMirrorController;
  private readonly governor: StreamGovernor;
  private readonly telemetry = new StreamTelemetry();
  private readonly now: () => number;
  /** Last observed cumulative player-underrun count, for per-tick delta. */
  private lastAudioUnderruns = 0;

  constructor(deps: AvMirrorSessionDeps = {}) {
    const startStream = deps.startStream ?? ((name, destination) => getC64API().startStream(name, destination));
    const stopStream = deps.stopStream ?? ((name) => getC64API().stopStream(name));
    this.now = deps.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    // The stored frame-rate mode is applied when a session starts (see beginSessionIfIdle), NOT at
    // construction — the app-wide singleton is built at import time, before localStorage-backed
    // settings are safe to read under test, so reading here would couple every importer to the setting.
    this.governor = new StreamGovernor("auto");

    this.audio = new AudioMirrorController({
      startStream: (_name, destination) => startStream("audio", destination),
      stopStream: () => stopStream("audio"),
      onChange: (s) => this.update({ audio: { state: s.state, droppedPackets: s.droppedPackets, error: s.error } }),
      createReceiver:
        deps.createAudioReceiver ?? ((opts) => createStreamReceiver({ ...opts, port: loadStreamAudioPort() })),
      createPlayer: deps.createPlayer,
      renderAudioForAnalysis: (samples, arrivalMs) => this.emitAudio(samples, arrivalMs),
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
    return () => {
      this.audioListeners.delete(handler);
    };
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

    const governor = this.governor.update(
      {
        audioBufferMs: signals.audioBufferMs,
        // Feed the underruns SINCE the last tick as the demote trigger; the cumulative total goes to telemetry.
        audioUnderruns: Math.max(0, signals.audioUnderruns - this.lastAudioUnderruns),
        // Only let the audio buffer/underrun signals drive video when audio is actually playing —
        // a video-only mirror has no player (bufferedMs = 0) and must not be pegged to the floor.
        audioActive: this.audioLive,
        videoQueueAgeMs: video.renderResidenceMs,
        frameProcessingP95Ms: undefined,
        localLatencyP99Ms: undefined,
      },
      nowMs,
    );
    this.lastAudioUnderruns = signals.audioUnderruns;
    this.applyKeepFraction(governor.effectiveFraction);

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
      effectiveFraction: governor.effectiveFraction,
      requestedMode: governor.requested,
    });
    this.emitStats();
  }

  /** Set the requested Live View frame-rate mode (§11.1). Applies immediately + records the transition. */
  setFrameRateMode(mode: FrameRateMode, nowMs: number = this.now()): void {
    const state = this.governor.setRequested(mode, nowMs);
    this.applyKeepFraction(state.effectiveFraction);
    this.emitStats();
  }

  getStatsSnapshot(): AvStatsSnapshot {
    return this.buildStatsSnapshot();
  }

  /** History buckets for a Stats chart window (seconds). Computed on demand (Stats open only). */
  statsHistory(windowSec: number): TelemetryBucket[] {
    return this.telemetry.buffersWindow(windowSec);
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
    // Apply the persisted user frame-rate mode now (deferred from construction). setRequested is a
    // no-op if it already matches, so restarts don't spam transitions.
    const stored = FRAME_RATE_MODE[loadStreamVideoFrameRateMode()];
    const state = this.governor.setRequested(stored, this.now());
    this.applyKeepFraction(state.effectiveFraction);
  }

  startAudio(): Promise<void> {
    this.beginSessionIfIdle();
    return this.audio.start();
  }

  stopAudio(): Promise<void> {
    return this.audio.stop();
  }

  toggleAudio(): Promise<void> {
    return this.audioLive ? this.stopAudio() : this.startAudio();
  }

  startVideo(): Promise<void> {
    this.beginSessionIfIdle();
    return this.video.start();
  }

  async stopVideo(): Promise<void> {
    await this.video.stop();
    this.latestFrame = null;
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
