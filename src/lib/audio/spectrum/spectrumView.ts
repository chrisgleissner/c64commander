/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { readSpectrum, setSpectrumEnabled, type SpectrumFrame } from "@/lib/native/audioFx";
import type { StreamUdpSpectrumRequest as SpectrumRequest } from "@/lib/native/streamUdp";
import {
  SPECTRUM_BALLISTICS,
  SPECTRUM_BALLISTICS_REDUCED,
  createBallistics,
  stepBallistics,
  type SpectrumBallisticsState,
} from "@/lib/audio/spectrum/spectrumBallistics";
import { SPECTRUM_BAND_COUNT, SPECTRUM_FLOOR_DB, foldBands } from "@/lib/audio/spectrum/spectrumBands";
import { NativeClockOffset } from "@/lib/audio/spectrum/spectrumClock";
import { readSpectrumPalette, type SpectrumPalette } from "@/lib/audio/spectrum/spectrumColors";
import {
  createSpectrumTierController,
  initialSpectrumTier,
  SPECTRUM_POLL_HZ,
  type SpectrumTier,
  type SpectrumTierController,
} from "@/lib/audio/spectrum/spectrumQuality";
import {
  computeLayout,
  createBarGradient,
  createMeterGradient,
  drawMeters,
  devicePixelRatioFor,
  drawBars,
  drawStaticLayer,
  type SpectrumContext,
  type FrameDrawOptions,
  type SpectrumLayout,
} from "@/lib/audio/spectrum/spectrumRenderer";

/** Latch time of the clip lamp after a sample reached full scale. */
export const CLIP_LAMP_HOLD_MS = 1500;
/** A frame source that stops delivering new analysis frames for this long counts as silent. */
export const SPECTRUM_STALE_AFTER_MS = 500;
/** How often the view asks whether sound has started while it has nothing to draw. */
export const SPECTRUM_IDLE_POLL_MS = 400;
/** The longest a pending bridge read may keep the animation loop awake. */
export const SPECTRUM_READ_WAIT_MS = 1000;
/** Never integrate more than this much time in one step, so a stalled tab does not jump. */
const MAX_STEP_MS = 100;
/** A frame is drawn when at least this share of its slot has passed, which lets a 60 Hz display carry 30 fps. */
const SLOT_TOLERANCE = 0.9;
const SETTLED_DB = SPECTRUM_FLOOR_DB + 1;
const READOUT_INTERVAL_MS = 100;
/** A frame drawn at the next tick is on the display one frame after that. */
const PRESENT_FRAMES_AHEAD = 2;
/** Frames asked for in one read, one display frame apart, so a late draw still finds the frame for its moment. */
const FRAMES_PER_READ = 4;
/** A new read is issued when fewer than this many display frames of sound are already waiting. */
const LOOK_AHEAD_FRAMES = 3;
const MAX_PENDING_FRAMES = 16;

export interface SpectrumReadout {
  /** Null while there is no sound to measure. */
  rmsDb: number | null;
  peakDb: number | null;
  clipped: boolean;
  channels?: readonly { label: string; rmsDb: number | null; peakDb: number | null }[];
}

export interface SpectrumLayer {
  canvas: CanvasImageSource;
  context: SpectrumContext;
}

export interface SpectrumViewOptions {
  canvas: HTMLCanvasElement;
  profile: string;
  onReadout?: (readout: SpectrumReadout) => void;
  onActiveChange?: (active: boolean) => void;
  onTierChange?: (tier: SpectrumTier) => void;
  read?: (request?: SpectrumRequest) => Promise<SpectrumFrame | null>;
  setEnabled?: (enabled: boolean) => Promise<boolean>;
  now?: () => number;
  requestFrame?: (callback: (timeMs: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  createLayer?: (widthPx: number, heightPx: number) => SpectrumLayer | null;
  reducedMotion?: () => boolean;
  deviceSignals?: () => { hardwareConcurrency?: number; deviceMemory?: number };
}

const defaultCreateLayer = (widthPx: number, heightPx: number): SpectrumLayer | null => {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext("2d");
  return context ? { canvas, context } : null;
};

const reducedMotionQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

const defaultReducedMotion = (): boolean =>
  document.documentElement.classList.contains("c64-motion-reduced") || reducedMotionQuery?.matches === true;

const defaultDeviceSignals = () => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory };
};

/**
 * Draws the live spectrum of the sound leaving the phone into one canvas.
 *
 * All motion is imperative: nothing here sets React state per frame. The loop runs only while the
 * view is visible, the document is showing and sound is moving; with nothing to draw it falls back
 * to a slow poll that notices when sound starts, and when the view is not visible it makes no calls
 * at all and tells the native analyser to switch itself off.
 */
export class SpectrumView {
  private readonly canvas: HTMLCanvasElement;
  private readonly profile: string;
  private readonly readFrame: (request?: SpectrumRequest) => Promise<SpectrumFrame | null>;
  private readonly setEnabled: (enabled: boolean) => Promise<boolean>;
  private readonly now: () => number;
  private readonly requestFrame: (callback: (timeMs: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly createLayer: (widthPx: number, heightPx: number) => SpectrumLayer | null;
  private readonly reducedMotion: () => boolean;
  private readonly options: SpectrumViewOptions;

  private controller: SpectrumTierController;
  private tier: SpectrumTier;
  private ballistics: SpectrumBallisticsState;
  private meterBallistics = createBallistics(4);
  private meterTargets = new Float32Array(4).fill(SPECTRUM_FLOOR_DB);
  private meterLabels: readonly string[] = ["L", "R"];
  private readonly channelClipUntil = new Float64Array(2);
  private readonly channelClipped = [false, false];
  private meterLatest = new Float32Array(4).fill(SPECTRUM_FLOOR_DB);
  private meterGradient: CanvasGradient | null = null;
  private folded = new Float32Array(SPECTRUM_BAND_COUNT);
  private latest = new Float32Array(SPECTRUM_BAND_COUNT).fill(SPECTRUM_FLOOR_DB);

  private ctx: SpectrumContext | null = null;
  private layer: SpectrumLayer | null = null;
  private layout: SpectrumLayout | null = null;
  private palette: SpectrumPalette | null = null;
  private gradient: CanvasGradient | null = null;
  private drawOptions: FrameDrawOptions | null = null;
  private ratio = 1;
  private cssWidth = 0;
  private cssHeight = 0;

  private visible = false;
  private documentShowing = true;
  private paused = false;
  private nativeEnabled = false;
  private frameHandle: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private clipTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInFlight = false;
  private readonly pending: Array<{ frame: SpectrumFrame; dueMs: number }> = [];
  private alignedMode = false;
  private lastDueMs = 0;
  private readonly clock = new NativeClockOffset();
  private frameIntervalMs = 1000 / 60;
  private readGeneration = 0;
  private answered = false;
  private lastPollAt = 0;
  private lastDrawAt = 0;
  private lastSequence = -1;
  private lastNewFrameAt = 0;
  private active = false;
  private rmsDb: number | null = null;
  private peakDb: number | null = null;
  private clipUntil = 0;
  private lastReadoutAt = 0;
  private lastReadoutKey = "";
  private disposed = false;
  private warnedBandCount = false;
  framesDrawn = 0;

  constructor(options: SpectrumViewOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.profile = options.profile;
    this.readFrame = options.read ?? readSpectrum;
    this.setEnabled = options.setEnabled ?? setSpectrumEnabled;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => window.requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
    this.createLayer = options.createLayer ?? defaultCreateLayer;
    this.reducedMotion = options.reducedMotion ?? defaultReducedMotion;
    const signals = (options.deviceSignals ?? defaultDeviceSignals)();
    this.tier = initialSpectrumTier({ profile: this.profile, ...signals });
    this.controller = createSpectrumTierController(this.tier, this.now());
    this.ballistics = createBallistics(this.tier.bars);
  }

  /** Frames read ahead of their display time and not yet shown. */
  get pendingFrameCount(): number {
    return this.pending.length;
  }

  get currentTier(): SpectrumTier {
    return this.tier;
  }

  /** Called whenever the canvas box changes size, in CSS pixels. */
  resize(cssWidth: number, cssHeight: number, rawRatio: number): void {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    const ratio = devicePixelRatioFor(rawRatio);
    if (width === this.cssWidth && height === this.cssHeight && ratio === this.ratio && this.ctx) return;
    this.cssWidth = width;
    this.cssHeight = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.rebuildStaticLayer();
    this.drawOnce();
  }

  /** The theme changed: read the colours again and redraw the fixed parts. */
  refreshTheme(): void {
    if (!this.ctx) return;
    this.rebuildStaticLayer();
    this.drawOnce();
  }

  /** Whether the view is on screen, and whether the tune is paused. The native analyser follows audible playback. */
  setState(state: { visible: boolean; paused: boolean }): void {
    this.visible = state.visible;
    this.paused = state.paused;
    this.apply();
  }

  setDocumentShowing(showing: boolean): void {
    this.documentShowing = showing;
    this.apply();
  }

  dispose(): void {
    this.disposed = true;
    this.visible = false;
    this.apply();
  }

  private get shouldAnalyse(): boolean {
    return this.visible && this.documentShowing && !this.disposed;
  }

  private get shouldEnableNative(): boolean {
    return this.shouldAnalyse && !this.paused;
  }

  private apply(): void {
    this.readGeneration += 1;
    const enableNative = this.shouldEnableNative;
    if (enableNative !== this.nativeEnabled) {
      this.nativeEnabled = enableNative;
      void this.setEnabled(enableNative).catch((error: unknown) => {
        addLog("warn", "Spectrum: changing analyser state failed", {
          service: "audio-fx",
          enabled: enableNative,
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      });
    }
    this.cancelLoops();
    if (!this.shouldAnalyse) {
      this.setActive(false);
      return;
    }
    this.pending.length = 0;
    this.lastDueMs = 0;
    this.alignedMode = false;
    this.controller.restart(this.now());
    this.answered = false;
    this.lastDrawAt = 0;
    this.lastNewFrameAt = this.now();
    if (this.paused) this.setActive(false);
    this.startFrameLoop();
  }

  private cancelLoops(): void {
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.clipTimer !== null) clearTimeout(this.clipTimer);
    this.clipTimer = null;
  }

  private startFrameLoop(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.frameHandle === null) this.frameHandle = this.requestFrame(this.tick);
  }

  private rebuildStaticLayer(): void {
    if (!this.ctx) return;
    this.palette = readSpectrumPalette(this.canvas);
    this.layout = computeLayout(this.cssWidth, this.cssHeight, this.palette.fontPx);
    this.ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.layer = this.createLayer(this.canvas.width, this.canvas.height);
    if (this.layer) {
      this.layer.context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      drawStaticLayer(this.layer.context, this.layout, this.palette, this.ratio, this.meterLabels);
    }
    this.meterGradient = createMeterGradient(this.ctx, this.layout, this.palette);
    this.gradient = createBarGradient(this.ctx, this.layout, this.palette);
    if (this.drawOptions) {
      this.drawOptions.layout = this.layout;
      this.drawOptions.palette = this.palette;
      this.drawOptions.gradient = this.gradient;
      this.drawOptions.ratio = this.ratio;
      this.drawOptions.meterLabels = this.meterLabels;
    } else {
      this.drawOptions = {
        layout: this.layout,
        palette: this.palette,
        tier: this.tier,
        gradient: this.gradient,
        glow: false,
        ratio: this.ratio,
        meterLabels: this.meterLabels,
      };
    }
  }

  private applyTier(next: SpectrumTier): void {
    const previous = this.ballistics;
    this.tier = next;
    this.ballistics = createBallistics(next.bars);
    if (next.bars < previous.levels.length) {
      foldBands(previous.levels, this.ballistics.levels);
      foldBands(previous.peaks, this.ballistics.peaks);
    }
    this.folded = new Float32Array(next.bars);
    if (this.drawOptions) this.drawOptions.tier = next;
    this.options.onTierChange?.(next);
    addLog("info", "Spectrum: quality tier changed", { service: "audio-fx", tier: next.index });
  }

  private pollIfDue(nowMs: number): void {
    if (this.pollInFlight) return;
    if (this.alignedMode) {
      const horizonMs = this.pending.length > 0 ? this.pending[this.pending.length - 1].dueMs : this.lastDueMs;
      const stepMs = this.frameIntervalMs;
      if (horizonMs - nowMs > LOOK_AHEAD_FRAMES * stepMs) return;
      const firstMs = Math.max(nowMs + PRESENT_FRAMES_AHEAD * stepMs, horizonMs + stepMs);
      this.lastPollAt = nowMs;
      this.read(false, {
        targetNanos: this.clock.nativeNanosAt(firstMs),
        count: FRAMES_PER_READ,
        stepNanos: Math.round(stepMs * 1e6),
      });
      return;
    }
    if (nowMs - this.lastPollAt < (1000 / SPECTRUM_POLL_HZ) * SLOT_TOLERANCE) return;
    this.lastPollAt = nowMs;
    this.read(false, { targetNanos: this.clock.nativeNanosAt(nowMs + PRESENT_FRAMES_AHEAD * this.frameIntervalMs) });
  }

  private read(idle: boolean, request?: SpectrumRequest): void {
    if (this.pollInFlight || !this.shouldEnableNative) return;
    this.pollInFlight = true;
    const generation = this.readGeneration;
    const sentAt = this.now();
    void this.readFrame(request)
      .then((frame) => {
        if (frame?.timestampNanos) this.clock.add(sentAt, this.now(), frame.timestampNanos);
        if (generation === this.readGeneration) this.receive(frame, request);
      })
      .catch((error: unknown) => {
        addLog("warn", "Spectrum: frame poll failed", {
          service: "audio-fx",
          idle,
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      })
      .finally(() => {
        this.pollInFlight = false;
        if (generation !== this.readGeneration) {
          if (this.shouldEnableNative) this.startFrameLoop();
          return;
        }
        this.answered = true;
        if (idle && this.shouldEnableNative && !this.isSounding(this.now())) this.scheduleIdlePoll();
      });
  }

  private receive(frame: SpectrumFrame | null, request?: SpectrumRequest): void {
    if (!frame || this.disposed) return;
    this.setActive(frame.active && !this.paused);
    const firstMs = request?.targetNanos ? this.clock.pageMsAt(request.targetNanos) : 0;
    this.alignedMode = frame.aligned === true && firstMs > 0;
    if (!this.alignedMode) {
      this.applyFrame(frame, false);
      return;
    }
    const stepMs = (request?.stepNanos ?? 0) / 1e6;
    this.enqueue(frame, firstMs);
    frame.ahead?.forEach((later, index) => this.enqueue(later, firstMs + (index + 1) * stepMs));
    if (this.shouldAnalyse && this.isSounding(this.now())) this.startFrameLoop();
  }

  private enqueue(frame: SpectrumFrame, dueMs: number): void {
    if (dueMs <= this.lastDueMs || this.pending.length >= MAX_PENDING_FRAMES) return;
    this.pending.push({ frame, dueMs });
  }

  private applyDue(nowMs: number): void {
    const limit = nowMs + this.frameIntervalMs * (PRESENT_FRAMES_AHEAD - 1 + 0.5);
    let applied = 0;
    while (this.pending.length > 0 && this.pending[0].dueMs <= limit) {
      const due = this.pending.shift()!;
      this.lastDueMs = due.dueMs;
      this.applyFrame(due.frame, applied > 0);
      applied += 1;
    }
  }

  private applyFrame(frame: SpectrumFrame, keepHigherPeaks: boolean): void {
    if (frame.sequence === this.lastSequence) return;
    this.lastSequence = frame.sequence;
    this.lastNewFrameAt = this.now();
    if (frame.bands.length !== SPECTRUM_BAND_COUNT) {
      if (!this.warnedBandCount) {
        this.warnedBandCount = true;
        addLog("warn", "Spectrum: the plugin returned an unexpected number of bands", {
          service: "audio-fx",
          expected: SPECTRUM_BAND_COUNT,
          received: frame.bands.length,
        });
      }
      return;
    }
    for (let i = 0; i < SPECTRUM_BAND_COUNT; i++) this.latest[i] = frame.bands[i];
    this.rmsDb = frame.rmsDb;
    this.peakDb = frame.peakDb;
    const channels = frame.channels;
    const count = channels?.length === 2 ? 2 : 1;
    const label = channels?.[0]?.id === "mono" ? "Mono" : "Mix";
    if (this.meterLabels.length !== count || (count === 1 && this.meterLabels[0] !== label)) {
      this.meterLabels = count === 2 ? ["L", "R"] : [label];
      this.rebuildStaticLayer();
    }
    const previousLeftPeak = this.meterLatest[1];
    const previousRightPeak = this.meterLatest[3];
    this.meterLatest.fill(SPECTRUM_FLOOR_DB);
    for (let channel = 0; channel < count; channel++) {
      const reading = channels?.[channel];
      this.meterLatest[channel * 2] = reading?.rmsDb ?? frame.rmsDb;
      const peak = reading?.peakDb ?? frame.peakDb;
      this.meterLatest[channel * 2 + 1] = keepHigherPeaks
        ? Math.max(peak, channel === 0 ? previousLeftPeak : previousRightPeak)
        : peak;
    }
    const receivedAt = this.now();
    if (frame.clipped) this.clipUntil = receivedAt + CLIP_LAMP_HOLD_MS;
    for (let channel = 0; channel < count; channel++) {
      const clipped = channels ? channels[channel]?.clipped : frame.clipped;
      if (clipped) this.channelClipUntil[channel] = receivedAt + CLIP_LAMP_HOLD_MS;
    }
    if (this.shouldAnalyse && this.isSounding(this.now())) this.startFrameLoop();
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.options.onActiveChange?.(active);
  }

  private isSounding(nowMs: number): boolean {
    return this.active && !this.paused && nowMs - this.lastNewFrameAt < SPECTRUM_STALE_AFTER_MS;
  }

  private isSettled(): boolean {
    const { levels, peaks } = this.ballistics;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i] > SETTLED_DB || peaks[i] > SETTLED_DB) return false;
    }
    const meterPeaks = this.meterBallistics.peaks;
    for (let i = 0; i < meterPeaks.length; i++) {
      if (meterPeaks[i] > SETTLED_DB) return false;
    }
    return true;
  }

  private readonly tick = (): void => {
    this.frameHandle = null;
    if (!this.shouldAnalyse) return;
    const nowMs = this.now();
    if (!this.paused) this.pollIfDue(nowMs);
    const slotMs = 1000 / this.tier.drawFps;
    if (this.lastDrawAt === 0 || nowMs - this.lastDrawAt >= slotMs * SLOT_TOLERANCE) {
      this.drawFrame(nowMs);
    }
    if (
      this.isSounding(nowMs) ||
      !this.isSettled() ||
      (!this.paused && !this.answered && nowMs - this.lastPollAt < SPECTRUM_READ_WAIT_MS)
    ) {
      this.startFrameLoop();
      return;
    }
    this.lastDrawAt = 0;
    this.emitReadout(nowMs, true);
    this.scheduleClipLampRelease(nowMs);
    if (!this.paused) this.scheduleIdlePoll();
  };

  private scheduleClipLampRelease(nowMs: number): void {
    if (this.clipTimer !== null || nowMs >= this.clipUntil) return;
    this.clipTimer = setTimeout(
      () => {
        this.clipTimer = null;
        this.paint(this.reducedMotion());
        this.emitReadout(this.now(), true);
      },
      this.clipUntil - nowMs + 5,
    );
  }

  private scheduleIdlePoll(): void {
    if (this.idleTimer !== null) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.read(true);
    }, SPECTRUM_IDLE_POLL_MS);
  }

  private drawFrame(nowMs: number): void {
    const started = this.now();
    this.applyDue(nowMs);
    const elapsed = this.lastDrawAt === 0 ? 1000 / this.tier.drawFps : Math.min(MAX_STEP_MS, nowMs - this.lastDrawAt);
    const sounding = this.isSounding(nowMs);
    if (sounding) foldBands(this.latest, this.folded);
    else this.folded.fill(SPECTRUM_FLOOR_DB);
    const reduced = this.reducedMotion();
    stepBallistics(this.ballistics, this.folded, elapsed, reduced ? SPECTRUM_BALLISTICS_REDUCED : SPECTRUM_BALLISTICS);
    if (sounding) this.meterTargets.set(this.meterLatest);
    else this.meterTargets.fill(SPECTRUM_FLOOR_DB);
    stepBallistics(
      this.meterBallistics,
      this.meterTargets,
      elapsed,
      reduced ? SPECTRUM_BALLISTICS_REDUCED : SPECTRUM_BALLISTICS,
    );
    this.catchMeterPeaks();
    this.paint(reduced);
    const previousDrawAt = this.lastDrawAt;
    if (previousDrawAt !== 0) {
      this.frameIntervalMs += (Math.min(50, Math.max(8, nowMs - previousDrawAt)) - this.frameIntervalMs) * 0.1;
    }
    this.lastDrawAt = nowMs;
    this.framesDrawn += 1;
    this.emitReadout(nowMs, false);
    if (previousDrawAt === 0) return;
    const changed = this.controller.report(nowMs, this.now() - started, nowMs - previousDrawAt);
    if (changed) this.applyTier(changed);
  }

  private catchMeterPeaks(): void {
    const { levels, peaks, holdMsLeft } = this.meterBallistics;
    for (let i = 1; i < levels.length; i += 2) {
      const target = this.meterTargets[i];
      if (target <= levels[i]) continue;
      levels[i] = target;
      if (target >= peaks[i]) {
        peaks[i] = target;
        holdMsLeft[i] = SPECTRUM_BALLISTICS.peakHoldMs;
      }
    }
  }

  private paint(reducedMotion: boolean): void {
    const { ctx, layout, palette } = this;
    if (!ctx || !layout || !palette) return;
    if (this.layer) ctx.drawImage(this.layer.canvas, 0, 0, this.cssWidth, this.cssHeight);
    const options = this.drawOptions;
    if (!options) return;
    options.glow = this.tier.glow && !reducedMotion;
    drawBars(ctx, options, this.ballistics);
    for (let channel = 0; channel < this.channelClipped.length; channel++) {
      this.channelClipped[channel] = this.now() < this.channelClipUntil[channel];
    }
    drawMeters(ctx, options, this.meterBallistics, this.meterGradient, this.channelClipped);
  }

  private drawOnce(): void {
    this.paint(true);
  }

  private emitReadout(nowMs: number, force: boolean): void {
    if (!this.options.onReadout) return;
    if (!force && nowMs - this.lastReadoutAt < READOUT_INTERVAL_MS) return;
    this.lastReadoutAt = nowMs;
    const sounding = this.isSounding(nowMs);
    const rmsDb = sounding && this.rmsDb !== null ? Math.round(this.rmsDb) : null;
    const peakDb = sounding && this.peakDb !== null ? Math.round(this.peakDb) : null;
    const clipped = nowMs < this.clipUntil;
    const key = `${rmsDb}|${peakDb}|${clipped}|${sounding ? this.meterLatest.join(",") : "silent"}`;
    if (key === this.lastReadoutKey) return;
    this.lastReadoutKey = key;
    this.options.onReadout({
      rmsDb,
      peakDb,
      clipped,
      channels: this.meterLabels.map((label, index) => ({
        label,
        rmsDb: sounding ? Math.round(this.meterLatest[index * 2]) : null,
        peakDb: sounding ? Math.round(this.meterLatest[index * 2 + 1]) : null,
      })),
    });
  }
}
