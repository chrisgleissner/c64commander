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
import { VicStreamAssembler, parseVicHeader } from "./vicStream";
import { videoStandardForHeight, type VideoStandard } from "./vicDecode";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";

export type VideoMirrorState = "off" | "connecting" | "live" | "error";

/** Max in-flight frame-start entries kept (a frame whose last line is lost never completes). */
const FRAME_START_CAP = 12;

export interface VideoMirrorSnapshot {
  state: VideoMirrorState;
  fps: number;
  droppedPackets: number;
  /** Video standard detected from the actual received frame height (PAL 272 / NTSC 240). */
  standard: VideoStandard;
  error: string | null;
}

export interface VideoMirrorDeps {
  createReceiver?: (options: StreamReceiverOptions) => StreamReceiver;
  startStream: (name: "video", destination: string) => Promise<unknown>;
  stopStream: (name: "video") => Promise<unknown>;
  onChange: (snapshot: VideoMirrorSnapshot) => void;
  /**
   * Frame sink: receives a full 52224-byte VIC frame, the detected frame height
   * (PAL 272 / NTSC 240) and the wire-arrival timestamp (ms) of the frame's FIRST
   * datagram — for every RENDERED frame. Frame-start (top of frame) is used because
   * the av-sync tone gate opens at the top raster line, so the video pop and the audio
   * tone onset share the same wire instant, letting the A/V sync analyzer cancel the
   * asymmetric frame-assembly/decode latency out of the measured offset.
   */
  renderFrame?: (frame: Uint8Array, height: number, arrivalMs: number) => void;
  /** Render every Nth assembled frame (default 1 = every frame). */
  frameThrottle?: number;
  /** Injectable clock for the rolling fps window (defaults to Date.now). */
  now?: () => number;
}

export class VideoMirrorController {
  private receiver: StreamReceiver | null = null;
  private assembler = new VicStreamAssembler();
  private snapshot: VideoMirrorSnapshot = { state: "off", fps: 0, droppedPackets: 0, standard: "PAL", error: null };
  private frameTick = 0;
  /**
   * Earliest wire-arrival time seen for each VIC frame number in flight. Keyed by frame number
   * (not a single "current frame") so cross-frame packet REORDERING on a jittery link cannot
   * misattribute a frame's start time — a straggler from the previous frame arriving after the
   * next one began does not move either frame's stamp. Bounded by {@link FRAME_START_CAP}.
   */
  private readonly frameStartByNum = new Map<number, number>();
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
    this.frameStartByNum.clear();
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

    receiver.onDatagram((bytes, arrivalMs) => {
      // Stamp each frame with the EARLIEST wire arrival of any of its packets (keyed by the VIC
      // frame number). The top of the frame is when the av-sync tone gate opens, so the video pop
      // and the audio tone share the wire instant — letting the analyzer cancel the asymmetric
      // frame-assembly/decode latency out of the offset. Using the frame number (every packet
      // carries it) keeps this correct even when a last-line packet is lost (no whole-frame skew)
      // or packets reorder across the frame boundary on a jittery link.
      const header = parseVicHeader(bytes);
      const frameNum = header ? header.frame : -1;
      const prevStart = this.frameStartByNum.get(frameNum);
      if (prevStart === undefined || arrivalMs < prevStart) this.frameStartByNum.set(frameNum, arrivalMs);

      const frame = this.assembler.ingest(bytes);
      if (!frame) return;
      const frameArrivalMs = this.frameStartByNum.get(frameNum) ?? arrivalMs;
      this.frameStartByNum.delete(frameNum);
      // Evict the oldest stragglers (frames whose last line never arrived) to bound the map.
      while (this.frameStartByNum.size > FRAME_START_CAP) {
        const oldest = this.frameStartByNum.keys().next().value;
        if (oldest === undefined) break;
        this.frameStartByNum.delete(oldest);
      }
      this.frameTick += 1;
      let fps = this.snapshot.fps;
      if (this.frameTick % this.throttle === 0) {
        this.deps.renderFrame?.(frame, this.assembler.frameHeight, frameArrivalMs);
        fps = this.recordRenderedFrame();
      }
      this.update({
        fps,
        droppedPackets: this.assembler.stats.droppedPackets,
        standard: videoStandardForHeight(this.assembler.frameHeight),
      });
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
    this.frameStartByNum.clear();
    this.renderTimes = [];
    this.update({ state: "off", fps: 0, error: null });
  }
}
