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
import { AudioBatcher } from "./audioStream";
import { AudioMirrorPlayer } from "./audioPlayer";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";

export type AudioMirrorState = "off" | "connecting" | "live" | "error";

export interface AudioMirrorSnapshot {
  state: AudioMirrorState;
  droppedPackets: number;
  chunks: number;
  error: string | null;
}

export interface AudioMirrorDeps {
  createReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  createPlayer?: () => AudioMirrorPlayer;
  startStream: (name: "audio", destination: string) => Promise<unknown>;
  stopStream: (name: "audio") => Promise<unknown>;
  onChange: (snapshot: AudioMirrorSnapshot) => void;
}

export class AudioMirrorController {
  private receiver: StreamReceiver | null = null;
  private player: AudioMirrorPlayer | null = null;
  private batcher = new AudioBatcher();
  private snapshot: AudioMirrorSnapshot = { state: "off", droppedPackets: 0, chunks: 0, error: null };

  constructor(private readonly deps: AudioMirrorDeps) {}

  getSnapshot(): AudioMirrorSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<AudioMirrorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange(this.snapshot);
  }

  async start(): Promise<void> {
    if (this.snapshot.state === "connecting" || this.snapshot.state === "live") return;
    this.batcher.reset();
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

    receiver.onDatagram((bytes) => {
      const batch = this.batcher.push(bytes);
      if (batch) {
        this.player?.playChunk(batch);
        this.update({
          chunks: this.player?.scheduledChunks ?? this.snapshot.chunks + 1,
          droppedPackets: this.batcher.stats.droppedPackets,
        });
      }
    });

    try {
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
    await this.player?.stop();
    this.player = null;
    this.batcher.reset();
    this.update({ state: "off", error: null });
  }
}
