/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability D — Audio Mirror controller.
 *
 * Ties the platform receiver → AudioBatcher → AudioMirrorPlayer and drives the
 * device stream start/stop. Kept as a plain class (deps injected) so the state
 * machine is unit tested without React or a real socket/AudioContext.
 */

import { addLog } from "@/lib/logging";
import { loadStreamNetworkBufferMs } from "@/lib/config/appSettings";
import { AudioBatcher, bytesToInt16LE, parseAudioPacket } from "./audioStream";
import { AudioPlaybackBuffer } from "./audioPlaybackBuffer";
import { AudioMirrorPlayer } from "./audioPlayer";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";

export type AudioMirrorState = "off" | "connecting" | "live" | "error";

export interface AudioMirrorSnapshot {
  state: AudioMirrorState;
  droppedPackets: number;
  chunks: number;
  error: string | null;
}

/** Live audio-pipeline signals for the governor + telemetry (read on the low-rate tick). */
export interface AudioMirrorSignals {
  /** WebAudio player buffer depth ahead of the audio clock (ms). */
  audioBufferMs: number;
  /** Cumulative player underruns (output ran dry). */
  audioUnderruns: number;
  /** Cumulative audio packets whose loss was concealed. */
  audioConcealed: number;
  /** Cumulative audio packets detected lost. */
  audioLostPackets: number;
}

export interface AudioMirrorDeps {
  createReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createPlayer?: () => AudioMirrorPlayer;
  startStream: (name: "audio", destination: string) => Promise<unknown>;
  stopStream: (name: "audio") => Promise<unknown>;
  onChange: (snapshot: AudioMirrorSnapshot) => void;
  /** Broadcast each decoded audio batch (interleaved Int16) — the ~32 ms player cadence. */
  renderAudio?: (samples: Int16Array) => void;
  /**
   * Per-packet (~4 ms) interleaved-Int16 feed with each packet's wire-arrival timestamp —
   * for the A/V sync analyzer. Finer-grained than {@link renderAudio} so the tone onset is
   * located to a single packet (not quantised to a 32 ms batch), and wire-stamped so the
   * measured audio↔video offset is independent of downstream buffering.
   */
  renderAudioForAnalysis?: (samples: Int16Array, arrivalMs: number) => void;
  /** Jitter/network buffer depth (ms) for the player path; defaults to the app setting. */
  networkBufferMs?: number;
}

export class AudioMirrorController {
  private receiver: StreamReceiver | null = null;
  private player: AudioMirrorPlayer | null = null;
  private batcher = new AudioBatcher();
  private playbackBuffer: AudioPlaybackBuffer | null = null;
  private snapshot: AudioMirrorSnapshot = { state: "off", droppedPackets: 0, chunks: 0, error: null };

  constructor(private readonly deps: AudioMirrorDeps) {}

  getSnapshot(): AudioMirrorSnapshot {
    return this.snapshot;
  }

  /**
   * Current audio-pipeline signals for the governor + telemetry. Cheap reads only (no allocation):
   * the player's buffer depth / underrun count and the jitter buffer's concealment stats.
   */
  getSignals(): AudioMirrorSignals {
    return {
      audioBufferMs: this.player?.bufferedMs ?? 0,
      audioUnderruns: this.player?.underrunCount ?? 0,
      audioConcealed: this.playbackBuffer?.stats.concealed ?? 0,
      audioLostPackets: this.playbackBuffer?.stats.packetsLost ?? 0,
    };
  }

  private update(patch: Partial<AudioMirrorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange(this.snapshot);
  }

  async start(): Promise<void> {
    if (this.snapshot.state === "connecting" || this.snapshot.state === "live") return;
    this.batcher.reset();
    // The jitter/network buffer reorders + delays for the player, and conceals losses so a
    // dropped packet fades instead of clicking (see AudioPlaybackBuffer). Its timeline is the
    // source of truth for the dropped-packet health counter.
    const buffer = new AudioPlaybackBuffer({
      delayMs: this.deps.networkBufferMs ?? loadStreamNetworkBufferMs(),
      emit: (body) => {
        const batch = this.batcher.pushBody(body);
        if (batch) {
          this.player?.playChunk(batch);
          this.update({
            chunks: this.player?.scheduledChunks ?? this.snapshot.chunks + 1,
            droppedPackets: buffer.stats.packetsLost,
          });
        }
      },
    });
    this.playbackBuffer = buffer;
    this.update({ state: "connecting", error: null, droppedPackets: 0, chunks: 0 });

    const player = (this.deps.createPlayer ?? (() => new AudioMirrorPlayer()))();
    const ok = await player.start();
    if (!ok) {
      this.update({ state: "error", error: "Audio playback is unavailable in this environment." });
      return;
    }
    this.player = player;

    const receiver = (this.deps.createReceiver ?? createStreamReceiver)({ name: "audio" });
    this.receiver = receiver;

    receiver.onStateChange((connection) => {
      if (connection === "open") {
        this.update({ state: "live" });
      } else if (connection === "error") {
        this.update({ state: "error", error: "Lost the audio stream connection." });
      } else if (connection === "closed" && this.snapshot.state !== "off") {
        this.update({ state: "off" });
      }
    });

    receiver.onDatagram((bytes, arrivalMs) => {
      const parsed = parseAudioPacket(bytes);
      if (!parsed) return;
      // Analyzer feed: RAW per-packet stream (fine-grained, wire-stamped) — measurement integrity.
      const samples = bytesToInt16LE(parsed.body);
      this.deps.renderAudioForAnalysis?.(samples, arrivalMs);
      this.deps.renderAudio?.(samples);
      // Player feed: reorder + delay + loss-conceal, then batch → play.
      buffer.push(parsed.seq, parsed.body, arrivalMs);
    });

    try {
      await receiver.ready?.(); // native binds a UDP socket first, learning its destination
      await this.deps.startStream("audio", receiver.destination);
    } catch (error) {
      addLog("warn", "Audio Mirror: device stream start failed", {
        error: (error as Error)?.message ?? String(error),
      });
      await this.stop();
      this.update({ state: "error", error: "Could not tell the device to start streaming audio." });
    }
  }

  async stop(): Promise<void> {
    try {
      await this.deps.stopStream("audio");
    } catch (error) {
      addLog("debug", "Audio Mirror: device stream stop failed (ignored)", {
        error: (error as Error)?.message ?? String(error),
      });
    }
    this.receiver?.close();
    this.receiver = null;
    // Flush any buffered tail so no packets are stranded, then release the player.
    this.playbackBuffer?.drainAll();
    this.playbackBuffer = null;
    await this.player?.stop();
    this.player = null;
    this.batcher.reset();
    this.update({ state: "off", error: null });
  }
}
