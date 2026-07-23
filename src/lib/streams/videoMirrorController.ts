/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability E — Video Mirror controller.
 *
 * Ties the platform receiver → VicStreamAssembler → a caller-provided frame sink
 * and drives the device video stream start/stop. Kept as a plain class (deps
 * injected) so the state machine, frame-throttle and fps counter are unit tested
 * without React, a real socket, or a canvas.
 *
 * Video is the expensive Live Mirror capability: it is CPU-budgeted per
 * `docs/plans/content-explorer/04-live-mirror.md` §4. The `frameThrottle` renders
 * only every Nth assembled frame while still receiving every datagram, so the
 * dropped-packet health and buffer stay current at a lower blit cost.
 */

import { addLog } from "@/lib/logging";
import { VicStreamAssembler } from "./vicStream";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";

export type VideoMirrorState = "off" | "connecting" | "live" | "error";

export interface VideoMirrorSnapshot {
  state: VideoMirrorState;
  fps: number;
  droppedPackets: number;
  error: string | null;
}

export interface VideoMirrorDeps {
  createReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  startStream: (name: "video", destination: string) => Promise<unknown>;
  stopStream: (name: "video") => Promise<unknown>;
  onChange: (snapshot: VideoMirrorSnapshot) => void;
  /**
   * Frame sink: receives a full 52224-byte VIC frame plus the detected frame
   * height (PAL 272 / NTSC 240) for every RENDERED frame.
   */
  renderFrame?: (frame: Uint8Array, height: number) => void;
  /** Render every Nth assembled frame (default 1 = every frame). */
  frameThrottle?: number;
  /** Injectable clock for the rolling fps window (defaults to Date.now). */
  now?: () => number;
}

export class VideoMirrorController {
  private receiver: StreamReceiver | null = null;
  private assembler = new VicStreamAssembler();
  private snapshot: VideoMirrorSnapshot = { state: "off", fps: 0, droppedPackets: 0, error: null };
  private frameTick = 0;
  private renderTimes: number[] = [];
  private readonly throttle: number;
  private readonly now: () => number;

  constructor(private readonly deps: VideoMirrorDeps) {
    this.throttle = Math.max(1, Math.floor(deps.frameThrottle ?? 1));
    this.now = deps.now ?? (() => Date.now());
  }

  getSnapshot(): VideoMirrorSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<VideoMirrorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange(this.snapshot);
  }

  /** Record a rendered frame and return the frame count in the last ~1s. */
  private recordRenderedFrame(): number {
    const now = this.now();
    this.renderTimes.push(now);
    const cutoff = now - 1000;
    while (this.renderTimes.length > 0 && this.renderTimes[0] < cutoff) this.renderTimes.shift();
    return this.renderTimes.length;
  }

  async start(): Promise<void> {
    if (this.snapshot.state === "connecting" || this.snapshot.state === "live") return;
    this.assembler.reset();
    this.frameTick = 0;
    this.renderTimes = [];
    this.update({ state: "connecting", error: null, fps: 0, droppedPackets: 0 });

    const receiver = (this.deps.createReceiver ?? createStreamReceiver)({ name: "video" });
    this.receiver = receiver;

    receiver.onStateChange((connection) => {
      if (connection === "open") {
        this.update({ state: "live" });
      } else if (connection === "error") {
        this.update({ state: "error", error: "Lost the video stream connection." });
      } else if (connection === "closed" && this.snapshot.state !== "off") {
        this.update({ state: "off" });
      }
    });

    receiver.onDatagram((bytes) => {
      const frame = this.assembler.ingest(bytes);
      if (!frame) return;
      this.frameTick += 1;
      let fps = this.snapshot.fps;
      if (this.frameTick % this.throttle === 0) {
        this.deps.renderFrame?.(frame, this.assembler.frameHeight);
        fps = this.recordRenderedFrame();
      }
      this.update({ fps, droppedPackets: this.assembler.stats.droppedPackets });
    });

    try {
      await receiver.ready?.(); // native binds a UDP socket first, learning its destination
      await this.deps.startStream("video", receiver.destination);
    } catch (error) {
      addLog("warn", "Video Mirror: device stream start failed", {
        error: (error as Error)?.message ?? String(error),
      });
      await this.stop();
      this.update({ state: "error", error: "Could not tell the device to start streaming video." });
    }
  }

  async stop(): Promise<void> {
    try {
      await this.deps.stopStream("video");
    } catch (error) {
      addLog("debug", "Video Mirror: device stream stop failed (ignored)", {
        error: (error as Error)?.message ?? String(error),
      });
    }
    this.receiver?.close();
    this.receiver = null;
    this.assembler.reset();
    this.frameTick = 0;
    this.renderTimes = [];
    this.update({ state: "off", fps: 0, error: null });
  }
}
