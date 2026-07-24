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
 * Ties the platform receiver → VicStreamAssembler (or the native onFrame fast path) → a
 * caller-provided frame sink, and drives the device video stream start/stop. Kept as a plain
 * class (deps injected) so the state machine, cadence throttle, coalescing present-queue and fps
 * counter are unit tested without React, a real socket, or a canvas.
 *
 * Presentation model (spec §6/§7.6/§16.3). A completed frame is not rendered inline; it is handed
 * to a coalescing **present queue** of depth one: only the newest ready frame survives to the next
 * present tick, so under a renderer backlog the pipeline **presents the newest frame and drops the
 * stale ones** instead of accumulating lag. This also means a frame that will not be displayed is
 * never decoded/blitted (§1.4). The present tick is an injected scheduler:
 *   - default = synchronous (present immediately — identical to the historical per-frame behaviour);
 *   - production = requestAnimationFrame (coalesce to the display refresh);
 *   - tests = a manual pump (drive bursts deterministically).
 *
 * Every completed source frame is accounted for in exactly one category (§2, never one generic
 * "dropped"): PRESENTED, intentional cadence DECIMATION (the throttle/governor divisor),
 * renderer-BACKLOG replacement (superseded before it could be presented), or frames LOST on the
 * wire (a frame whose last-line packet never arrived — counted by the assembler / native plugin).
 */

import { addLog } from "@/lib/logging";
import { VicStreamAssembler, parseVicHeader } from "./vicStream";
import { videoStandardForHeight, type VideoStandard } from "./vicDecode";
import { createStreamReceiver, type StreamReceiver, type StreamReceiverOptions } from "./streamReceiver";

export type VideoMirrorState = "off" | "connecting" | "live" | "error";

/** Max in-flight frame-start entries kept (a frame whose last line is lost never completes). */
const FRAME_START_CAP = 12;

/** Default present-queue residence budget (ms) beyond which a presented frame is flagged late. */
export const DEFAULT_MAX_PRESENTATION_AGE_MS = 120;

/**
 * Health/fps snapshot broadcasts are coalesced to at most one per this interval (~10 Hz). The
 * snapshot changes on every completed frame (~50/s), and broadcasting each one re-renders every
 * subscriber 50×/s for no user benefit — HIL showed this per-frame React churn, not the frame
 * decode, was the bulk of the video CPU. State/error transitions bypass the throttle.
 */
export const SNAPSHOT_EMIT_INTERVAL_MS = 100;

/** Monotonic presentation clock; falls back to Date.now where performance is absent. */
const perfNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Clamp a keep-fraction into (0, 1]. 0 or negative would stall video entirely, so floor above 0. */
const clampFraction = (fraction: number): number => {
  if (!Number.isFinite(fraction) || fraction >= 1) return 1;
  return fraction <= 0 ? 0.01 : fraction;
};

export interface VideoMirrorSnapshot {
  state: VideoMirrorState;
  /** Actual PRESENTED frame rate (frames rendered in the last ~1s), spec §12.1. */
  fps: number;
  droppedPackets: number;
  /** Frames LOST — gaps in the VIC frame-number sequence (a frame whose last-line packet never arrived). */
  framesLost: number;
  /** Source frames intentionally not presented by the cadence divisor (throttle/governor). Not a defect. */
  decimated: number;
  /** Ready frames superseded by a newer one before they could be presented (renderer-backlog replacement). */
  backlogReplacements: number;
  /** Frames actually handed to the sink (presented). */
  presented: number;
  /** Source frames received COMPLETE (no missing packets). §9.1 slot outcome. */
  completeFrames: number;
  /**
   * Frames whose assembly had missing line packets → the gaps retain the PREVIOUS frame's pixels
   * (temporal region concealment; the assembler never clears its buffer). §9 partial concealment.
   */
  partialConcealed: number;
  /**
   * Whole source frames LOST (never completed) → the previous frame is held on the canvas (a
   * deliberate temporal repeat). Ensures every source slot has an outcome (§9.1 / no unexplained gaps).
   */
  repeatedFrames: number;
  /** Most recent present-queue residence (ms, presentation clock): ready → presented. */
  renderResidenceMs: number;
  /** Max present-queue residence since start (ms) — the video queue-age bound telemetry (§6). */
  maxResidenceMs: number;
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
   * (PAL 272 / NTSC 240) and the wire-arrival timestamp (ms) of the frame's FIRST datagram — for
   * every PRESENTED frame. Frame-start (top of frame) is used because the av-sync tone gate opens
   * at the top raster line, so the video pop and the audio tone onset share the same wire instant.
   */
  renderFrame?: (frame: Uint8Array, height: number, arrivalMs: number) => void;
  /** Present every Nth assembled frame (default 1 = every frame). Overridden at runtime by the governor. */
  frameThrottle?: number;
  /** Injected present scheduler (default synchronous). Production wires requestAnimationFrame. */
  schedulePresent?: (present: () => void) => void;
  /** Present-queue residence budget (ms) above which a presented frame is flagged late. */
  maxPresentationAgeMs?: number;
  /** Injectable presentation clock (defaults to performance.now / Date.now). */
  now?: () => number;
}

interface PendingFrame {
  frame: Uint8Array;
  height: number;
  arrivalMs: number;
  readyMs: number;
}

export class VideoMirrorController {
  private receiver: StreamReceiver | null = null;
  private assembler = new VicStreamAssembler();
  private snapshot: VideoMirrorSnapshot = {
    state: "off",
    fps: 0,
    droppedPackets: 0,
    framesLost: 0,
    decimated: 0,
    backlogReplacements: 0,
    presented: 0,
    completeFrames: 0,
    partialConcealed: 0,
    repeatedFrames: 0,
    renderResidenceMs: 0,
    maxResidenceMs: 0,
    standard: "PAL",
    error: null,
  };
  private readonly frameStartByNum = new Map<number, number>();
  private renderTimes: number[] = [];
  /** Coalescing present queue of depth one (§7.6): only the newest ready frame survives. */
  private pending: PendingFrame | null = null;
  private presentScheduled = false;
  private decimated = 0;
  private backlogReplacements = 0;
  private presented = 0;
  private completeFrames = 0;
  private partialConcealed = 0;
  private repeatedFrames = 0;
  /** Cumulative dropped/lost at the previous completed frame, for per-frame slot classification. */
  private prevDroppedPackets = 0;
  private prevFramesLost = 0;
  private maxResidenceMs = 0;
  /** The governor's requested keep-fraction (0,1]. Realised natively when the transport supports it. */
  private requestedKeepFraction: number;
  /** JS-side keep-fraction, (0,1]. 1 when the native transport decimates; else = requested. */
  private keepFraction: number;
  /** Phase accumulator for deterministic JS-side fractional decimation (Bresenham-style). */
  private presentPhase = 0;
  private readonly maxPresentationAgeMs: number;
  private readonly schedulePresent: (present: () => void) => void;
  private readonly now: () => number;

  constructor(private readonly deps: VideoMirrorDeps) {
    this.requestedKeepFraction = clampFraction(1 / Math.max(1, Math.floor(deps.frameThrottle ?? 1)));
    this.keepFraction = this.requestedKeepFraction;
    this.maxPresentationAgeMs = deps.maxPresentationAgeMs ?? DEFAULT_MAX_PRESENTATION_AGE_MS;
    // Default scheduler is synchronous: present immediately, preserving the historical per-frame path.
    this.schedulePresent = deps.schedulePresent ?? ((present) => present());
    this.now = deps.now ?? perfNow;
  }

  getSnapshot(): VideoMirrorSnapshot {
    return this.snapshot;
  }

  /**
   * Set the fraction of source frames to present, (0,1] (the governor drives this). 1 = every source
   * frame, 0.5 = half, 0.25 = a quarter, 0.73 = ~73%. Realised by a phase-accumulator decimator, so
   * the discrete cases reduce to exact every-Nth cadence and fractional targets average correctly.
   */
  setKeepFraction(fraction: number): void {
    this.requestedKeepFraction = clampFraction(fraction);
    this.applyCadence();
  }

  /** Back-compat: set an integer cadence divisor (N ⇒ present every Nth frame ⇒ keepFraction 1/N). */
  setFrameThrottle(divisor: number): void {
    this.setKeepFraction(1 / Math.max(1, Math.floor(divisor)));
  }

  /**
   * Apply the requested cadence: prefer NATIVE decimation (the transport skips the Base64 encode +
   * bridge of unpresented frames — the real CPU win) and then present every frame JS receives;
   * otherwise decimate in JS. Re-applied on start once the receiver exists.
   */
  private applyCadence(): void {
    const native = this.receiver?.setNativeCadence;
    if (native) {
      native.call(this.receiver, this.requestedKeepFraction);
      this.keepFraction = 1;
    } else {
      this.keepFraction = this.requestedKeepFraction;
    }
  }

  /** Integer divisor view of the current keep-fraction (1/fraction, rounded) — for existing callers. */
  get frameThrottle(): number {
    return Math.max(1, Math.round(1 / this.requestedKeepFraction));
  }

  get keepFractionValue(): number {
    return this.keepFraction;
  }

  private lastEmitMs = -Infinity;

  private update(patch: Partial<VideoMirrorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    // Always keep getSnapshot() current (above); throttle only the React BROADCAST. State/error
    // transitions emit immediately; per-frame health/fps updates coalesce to ~10 Hz. Stats reads
    // live via the session tick, so it does not lose freshness.
    const important = patch.state !== undefined || patch.error !== undefined;
    const now = this.now();
    if (important || now - this.lastEmitMs >= SNAPSHOT_EMIT_INTERVAL_MS) {
      this.lastEmitMs = now;
      this.deps.onChange(this.snapshot);
    }
  }

  /**
   * A complete frame is ready (from the native fast path or JS assembly). Update health for EVERY
   * frame, then either intentionally decimate it (cadence divisor) or enqueue it for coalesced
   * presentation. `arrivalMs` is the frame-start wire time; health counters always advance so
   * dropped/lost stay live even for decimated frames.
   */
  private handleCompletedFrame(
    frame: Uint8Array,
    height: number,
    arrivalMs: number,
    droppedPackets: number,
    framesLost: number,
    present = true,
  ): void {
    const standard = videoStandardForHeight(height);
    // Presentation-slot accounting (§9.1): classify this source frame, and account for any whole
    // source frames LOST just before it as repeats (the previous frame is held on the canvas). These
    // classify every source slot so there are no unexplained missing presentation slots (§16.3).
    const deltaLost = Math.max(0, framesLost - this.prevFramesLost);
    const deltaDropped = Math.max(0, droppedPackets - this.prevDroppedPackets);
    this.prevFramesLost = framesLost;
    this.prevDroppedPackets = droppedPackets;
    this.repeatedFrames += deltaLost;
    if (deltaDropped > 0) this.partialConcealed += 1;
    else this.completeFrames += 1;

    // Native decimation: the transport already decided to skip this frame (payload elided). Count it
    // as intentional cadence decimation and render nothing — the JS cadence is a no-op (keepFraction 1).
    if (present === false) {
      this.decimated += 1;
      this.update({ droppedPackets, framesLost, decimated: this.decimated, standard, ...this.slotCounts() });
      return;
    }
    // JS-side fractional cadence (web path, or native transport that isn't decimating): accumulate
    // the keep-fraction and present when it crosses 1 (subtract 1, keeping the remainder so the
    // long-run average equals the target). A small epsilon absorbs float error (0.1×10 lands one).
    this.presentPhase += this.keepFraction;
    if (this.presentPhase + 1e-9 < 1) {
      // Intentional cadence decimation — not a defect, counted separately (§2/§16.3).
      this.decimated += 1;
      this.update({ droppedPackets, framesLost, decimated: this.decimated, standard, ...this.slotCounts() });
      return;
    }
    this.presentPhase -= 1;
    this.enqueueForPresent({ frame, height, arrivalMs, readyMs: this.now() });
    this.update({ droppedPackets, framesLost, standard, ...this.slotCounts() });
  }

  /** The presentation-slot classification counters (§9.1), for the snapshot patch. */
  private slotCounts(): Pick<VideoMirrorSnapshot, "completeFrames" | "partialConcealed" | "repeatedFrames"> {
    return {
      completeFrames: this.completeFrames,
      partialConcealed: this.partialConcealed,
      repeatedFrames: this.repeatedFrames,
    };
  }

  /** Coalesce into the depth-one present queue; a superseded ready frame is a backlog replacement. */
  private enqueueForPresent(next: PendingFrame): void {
    if (this.pending) this.backlogReplacements += 1; // previous ready frame never got presented
    this.pending = next;
    if (!this.presentScheduled) {
      this.presentScheduled = true;
      this.schedulePresent(() => this.present());
    }
  }

  /** Present the newest ready frame (drop-late is implicit: only the newest survives the queue). */
  private present(): void {
    this.presentScheduled = false;
    const frame = this.pending;
    this.pending = null;
    if (!frame || this.snapshot.state === "off") return;
    const residence = Math.max(0, this.now() - frame.readyMs);
    if (residence > this.maxResidenceMs) this.maxResidenceMs = residence;
    this.deps.renderFrame?.(frame.frame, frame.height, frame.arrivalMs);
    this.presented += 1;
    const fps = this.recordRenderedFrame();
    this.update({
      fps,
      presented: this.presented,
      backlogReplacements: this.backlogReplacements,
      renderResidenceMs: residence,
      maxResidenceMs: this.maxResidenceMs,
    });
  }

  /** Record a presented frame and return the frame count in the last ~1s (actual presented fps). */
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
    this.resetPresentation();
    this.update({
      state: "connecting",
      error: null,
      fps: 0,
      droppedPackets: 0,
      framesLost: 0,
      decimated: 0,
      backlogReplacements: 0,
      presented: 0,
      completeFrames: 0,
      partialConcealed: 0,
      repeatedFrames: 0,
      renderResidenceMs: 0,
      maxResidenceMs: 0,
    });

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

    // Native fast path: the Android plugin reassembles VIC datagrams into whole frames and crosses
    // the Capacitor bridge once per FRAME (~50/s) instead of once per PACKET (~3400/s). When the
    // receiver assembles frames it fires `onFrame`; otherwise it fires `onDatagram` and we assemble
    // in JS. Only one path is active per receiver, so registering both is safe.
    receiver.onFrame?.((frame, height, arrivalMs, droppedPackets, framesLost, present) => {
      this.handleCompletedFrame(frame, height, arrivalMs, droppedPackets, framesLost, present);
    });
    // Push the current governor cadence to the native transport now that the receiver exists (so a
    // decimating build skips the encode+bridge of unpresented frames from the start).
    this.applyCadence();

    receiver.onDatagram((bytes, arrivalMs) => {
      // Stamp each frame with the EARLIEST wire arrival of any of its packets (keyed by the VIC
      // frame number), so cross-frame reordering cannot skew the frame-start time the analyzer uses.
      const header = parseVicHeader(bytes);
      const frameNum = header ? header.frame : -1;
      const prevStart = this.frameStartByNum.get(frameNum);
      if (prevStart === undefined || arrivalMs < prevStart) this.frameStartByNum.set(frameNum, arrivalMs);

      const frame = this.assembler.ingest(bytes);
      if (!frame) return;
      const frameArrivalMs = this.frameStartByNum.get(frameNum) ?? arrivalMs;
      this.frameStartByNum.delete(frameNum);
      while (this.frameStartByNum.size > FRAME_START_CAP) {
        const oldest = this.frameStartByNum.keys().next().value;
        if (oldest === undefined) break;
        this.frameStartByNum.delete(oldest);
      }
      this.handleCompletedFrame(
        frame,
        this.assembler.frameHeight,
        frameArrivalMs,
        this.assembler.stats.droppedPackets,
        this.assembler.stats.lostFrames,
      );
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

  private resetPresentation(): void {
    this.presentPhase = 0;
    this.frameStartByNum.clear();
    this.renderTimes = [];
    this.pending = null;
    this.presentScheduled = false;
    this.decimated = 0;
    this.backlogReplacements = 0;
    this.presented = 0;
    this.completeFrames = 0;
    this.partialConcealed = 0;
    this.repeatedFrames = 0;
    this.prevDroppedPackets = 0;
    this.prevFramesLost = 0;
    this.maxResidenceMs = 0;
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
    this.resetPresentation();
    this.update({
      state: "off",
      fps: 0,
      framesLost: 0,
      decimated: 0,
      backlogReplacements: 0,
      presented: 0,
      completeFrames: 0,
      partialConcealed: 0,
      repeatedFrames: 0,
      renderResidenceMs: 0,
      maxResidenceMs: 0,
      error: null,
    });
  }
}
