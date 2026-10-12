/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * The Android plugin behind on-device SID playback (`SidAudioPlugin.kt`): the native local audio
 * feed every renderer writes through, the PCM store libSidplayEZ renders into, and the
 * libSidplayEZ renderers. Android only; web and iOS play through Web Audio and never load it.
 */

export interface SidAudioDescription {
  sidplayezAvailable: boolean;
  sidplayezUnavailableReason?: string | null;
  sidplayezRevision?: string | null;
  abi?: string | null;
  binaryPortInstalled: boolean;
  binaryPortError?: string | null;
  binaryPortProbes: number;
  binaryPortRejected: number;
}

export interface SidAudioSessionStats {
  known: boolean;
  writtenFrames?: number;
  playedFrames?: number;
  bufferedMs?: number;
  queuedFrames?: number;
  underruns?: number;
  silentSeconds?: number;
  silentFault?: boolean;
  reopens?: number;
  active?: boolean;
  superseded?: boolean;
  missingSegments?: number;
  outputOpen?: boolean;
  openFailures?: number;
}

export interface SidAudioOpenSession {
  serial: number;
  sampleRate: number;
  bufferMs: number;
  maxRingMs: number;
  trackBursts: number;
  primeMs: number;
}

export interface SidAudioTuneRequest {
  renderer: number;
  /** Base64 of the PSID/RSID file. Control-plane data: a tune is at most 64 KiB. */
  sid: string;
  songIndex: number;
  sampleRate: number;
  kernal?: string;
  basic?: string;
  sidModel?: "MOS6581" | "MOS8580";
}

export interface SidAudioOpened {
  sampleRate: number;
  channels: number;
  tuneInfo: Record<string, unknown> | null;
  constructMs: number;
  loadMs: number;
}

export interface SidAudioRendered {
  /** 0 with `frames` 0 when the tune has nothing more to render. */
  bufferId: number;
  frames: number;
  renderMs: number;
}

export interface SidAudioPrerenderEvent {
  renderer: number;
  id: number;
  /** `cancelled` keeps the buffer: the engine may already be playing from it, and releases it itself. */
  kind: "chunk" | "done" | "cancelled" | "error";
  bufferId: number;
  /** Frames rendered so far, this slice included. */
  frames: number;
  seconds: number;
  error?: string | null;
}

export interface SidAudioPlugin {
  describe(): Promise<SidAudioDescription>;
  attach(): Promise<void>;

  openSession(options: SidAudioOpenSession): Promise<void>;
  enqueueBuffer(options: {
    serial: number;
    seq: number;
    bufferId: number;
    startFrame: number;
    frames: number;
  }): Promise<{ missing?: boolean }>;
  /** Fallback PCM path for a WebView without ArrayBuffer messages: base64 stereo S16LE. */
  enqueuePcm(options: { serial: number; seq: number; data: string }): Promise<void>;
  flush(options: { serial: number; seq: number }): Promise<void>;
  pause(options: { serial: number }): Promise<void>;
  resume(options: { serial: number }): Promise<void>;
  setGain(options: { gain: number }): Promise<void>;
  fade(options: { serial: number; seq: number; target: number; ms: number }): Promise<void>;
  fadeIn(options: { serial: number; seq: number; ms: number }): Promise<void>;
  resetSilence(options: { serial: number }): Promise<void>;
  beginTransition(options: { serial: number; seq: number; seconds: number; rampOut?: boolean }): Promise<void>;
  takeTail(options: { serial: number; seq: number; tailId: number; maxSeconds: number }): Promise<void>;
  adoptTail(options: { serial: number; seq: number; tailId: number; seconds: number }): Promise<void>;
  release(options: { serial: number; seq: number }): Promise<void>;
  close(options: { serial: number }): Promise<void>;
  stats(options: { serial: number }): Promise<SidAudioSessionStats>;
  releaseBuffers(options: { bufferIds: number[] }): Promise<{ held: number }>;

  createRenderer(options: { background: boolean }): Promise<{ renderer: number }>;
  openTune(options: SidAudioTuneRequest): Promise<SidAudioOpened>;
  render(options: { renderer: number; seconds: number }): Promise<SidAudioRendered>;
  seek(options: { renderer: number; seconds: number }): Promise<{ positionSeconds: number }>;
  prerender(options: SidAudioTuneRequest & { id: number; seconds: number }): Promise<void>;
  cancelPrerender(options: { renderer: number }): Promise<void>;
  closeTune(options: { renderer: number }): Promise<void>;
  disposeRenderer(options: { renderer: number }): Promise<void>;
  addListener(eventName: "prerender", listener: (event: SidAudioPrerenderEvent) => void): Promise<PluginListenerHandle>;
}

export const SidAudio = registerPlugin<SidAudioPlugin>("SidAudio");
