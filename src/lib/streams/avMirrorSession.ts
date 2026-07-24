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
import { loadStreamAudioPort, loadStreamNativeVideoAssembly, loadStreamVideoPort } from "@/lib/config/appSettings";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";
import { AudioMirrorController, type AudioMirrorState } from "./audioMirrorController";
import { VideoMirrorController, type VideoMirrorState } from "./videoMirrorController";
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

export class AvMirrorSession {
  private snapshot: AvMirrorSnapshot = INITIAL;
  private readonly listeners = new Set<AvMirrorListener>();
  private readonly frameListeners = new Set<AvMirrorFrameHandler>();
  private readonly audioListeners = new Set<AvMirrorAudioHandler>();
  private latestFrame: { frame: Uint8Array; height: number; arrivalMs: number } | null = null;
  private readonly audio: AudioMirrorController;
  private readonly video: VideoMirrorController;

  constructor(deps: AvMirrorSessionDeps = {}) {
    const startStream = deps.startStream ?? ((name, destination) => getC64API().startStream(name, destination));
    const stopStream = deps.stopStream ?? ((name) => getC64API().stopStream(name));

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
      frameThrottle: deps.videoFrameThrottle,
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

  get audioLive(): boolean {
    return isLiveState(this.snapshot.audio.state);
  }

  get videoLive(): boolean {
    return isLiveState(this.snapshot.video.state);
  }

  startAudio(): Promise<void> {
    return this.audio.start();
  }

  stopAudio(): Promise<void> {
    return this.audio.stop();
  }

  toggleAudio(): Promise<void> {
    return this.audioLive ? this.stopAudio() : this.startAudio();
  }

  startVideo(): Promise<void> {
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
