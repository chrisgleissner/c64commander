/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer A/V Mirror — real-time Audio/Video sync analyzer.
 *
 * Drives the bundled `av-sync-auto` C64 program (from the c64stream project), which every
 * 48 frames flashes the whole screen **white** for exactly one frame while gating an
 * audible SID **tone** at the same instant. Both the flash and the tone leave the device
 * simultaneously, travel over the two separate mirror streams, and are decoded in the app;
 * the time between the app SEEING the white frame and HEARING the tone is the A/V pipeline
 * skew we measure.
 *
 * Detection is deliberately simple (no cv2/numpy like c64stream's offline OBS analyzer):
 *   - Video pop: the mean luminance of a decoded frame spikes far above the dark baseline.
 *   - Audio pop: the RMS of an audio chunk spikes far above the silent baseline.
 * Each detector reports a rising-edge event once per flash/tone (de-bounced). A matcher
 * pairs each video pop with the nearest audio pop within a window and records the signed
 * delta (audio − video) in milliseconds; positive means audio lags the picture.
 *
 * Pure and side-effect-free: no DOM, no React. All timestamps are supplied by the caller
 * (the arrival/decode time of each frame / audio chunk on a single monotonic clock).
 */

import { VIC_PALETTE_RGB } from "@/lib/streams/vicDecode";

/** Per-palette-index luma (Rec. 601), for cheap frame-brightness without full RGBA decode. */
const LUMA_BY_INDEX: number[] = VIC_PALETTE_RGB.map(([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b);

export interface AvSyncStats {
  /** Number of matched A/V pop pairs since the last reset. */
  count: number;
  /** Most recent signed offset (audio − video), ms; null until the first match. */
  lastMs: number | null;
  minMs: number | null;
  avgMs: number | null;
  p90Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  /** Video / audio pops seen but not (yet) matched to the other stream. */
  unmatchedVideo: number;
  unmatchedAudio: number;
}

export interface AvSyncOptions {
  /** Sample every Nth byte of the packed frame for the brightness mean (default 7). */
  frameSampleStep?: number;
  /** A frame is a "white pop" when its mean luma exceeds this (0–255, default 96). */
  videoPopMinLuma?: number;
  /** …and exceeds the dark baseline by at least this much (default 48). */
  videoPopDelta?: number;
  /** An audio chunk is a "tone pop" when its RMS exceeds this absolute level (Int16, default 1500). */
  audioPopMinRms?: number;
  /** …and exceeds the silent baseline by at least this much (default 800). */
  audioPopDelta?: number;
  /** Max |audio−video| time to still call two pops the same event (ms, default 250). */
  matchWindowMs?: number;
  /** Drop an unmatched pop older than this (ms, default 1000). */
  popTtlMs?: number;
  /** Exponential smoothing for the baselines (0–1, default 0.1). */
  baselineEma?: number;
}

const DEFAULTS: Required<AvSyncOptions> = {
  frameSampleStep: 7,
  videoPopMinLuma: 96,
  videoPopDelta: 48,
  audioPopMinRms: 1500,
  audioPopDelta: 800,
  matchWindowMs: 250,
  popTtlMs: 1000,
  baselineEma: 0.1,
};

interface Pop {
  timestampMs: number;
}

const percentile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
};

/** Mean luma of a packed 4bpp VIC frame (two pixels per byte), subsampled. */
export const meanFrameLuma = (frame: Uint8Array, step: number): number => {
  if (frame.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < frame.length; i += step) {
    const byte = frame[i];
    sum += LUMA_BY_INDEX[byte & 0x0f] + LUMA_BY_INDEX[byte >> 4];
    n += 2;
  }
  return n === 0 ? 0 : sum / n;
};

/** Root-mean-square amplitude of an Int16 audio chunk. */
export const rmsInt16 = (samples: Int16Array): number => {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
};

export class AvSyncAnalyzer {
  private readonly opts: Required<AvSyncOptions>;
  private videoBaseline = 0;
  private audioBaseline = 0;
  private videoArmed = true;
  private audioArmed = true;
  private pendingVideo: Pop[] = [];
  private pendingAudio: Pop[] = [];
  private readonly offsets: number[] = [];
  private last: number | null = null;

  /**
   * @param options  detection/matching tuning.
   * @param onPop     fired the instant a video/audio pop is detected (rising edge), BEFORE
   *                  matching — with the same timestamp passed to push. The hook uses it to
   *                  correlate a pop with the JS render/observe time for press→see/hear latency.
   */
  constructor(
    options: AvSyncOptions = {},
    private readonly onPop?: (kind: "video" | "audio", timestampMs: number) => void,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** Feed a decoded video frame; returns the signed offset (ms) if this completed a match. */
  pushVideoFrame(frame: Uint8Array, timestampMs: number): number | null {
    const mean = meanFrameLuma(frame, this.opts.frameSampleStep);
    const isPop = mean >= this.opts.videoPopMinLuma && mean >= this.videoBaseline + this.opts.videoPopDelta;
    if (!isPop) {
      this.videoBaseline += this.opts.baselineEma * (mean - this.videoBaseline);
      this.videoArmed = true;
      return null;
    }
    if (!this.videoArmed) return null; // still inside the same flash
    this.videoArmed = false;
    return this.register("video", timestampMs);
  }

  /** Feed an audio chunk (interleaved or mono Int16); returns the offset (ms) if matched. */
  pushAudioSamples(samples: Int16Array, timestampMs: number): number | null {
    const rms = rmsInt16(samples);
    const isPop = rms >= this.opts.audioPopMinRms && rms >= this.audioBaseline + this.opts.audioPopDelta;
    if (!isPop) {
      this.audioBaseline += this.opts.baselineEma * (rms - this.audioBaseline);
      this.audioArmed = true;
      return null;
    }
    if (!this.audioArmed) return null; // still inside the same tone
    this.audioArmed = false;
    return this.register("audio", timestampMs);
  }

  private register(kind: "video" | "audio", timestampMs: number): number | null {
    this.onPop?.(kind, timestampMs);
    // Prune first — it reassigns the pending arrays — then capture the current references.
    this.prune(timestampMs);
    const own = kind === "video" ? this.pendingVideo : this.pendingAudio;
    const other = kind === "video" ? this.pendingAudio : this.pendingVideo;

    // Match to the nearest opposite-stream pop within the window.
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < other.length; i++) {
      const delta = Math.abs(timestampMs - other[i].timestampMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDelta <= this.opts.matchWindowMs) {
      const matched = other.splice(bestIdx, 1)[0];
      const videoTs = kind === "video" ? timestampMs : matched.timestampMs;
      const audioTs = kind === "audio" ? timestampMs : matched.timestampMs;
      const offset = audioTs - videoTs;
      this.offsets.push(offset);
      this.last = offset;
      return offset;
    }
    own.push({ timestampMs });
    return null;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.opts.popTtlMs;
    this.pendingVideo = this.pendingVideo.filter((p) => p.timestampMs >= cutoff);
    this.pendingAudio = this.pendingAudio.filter((p) => p.timestampMs >= cutoff);
  }

  getStats(): AvSyncStats {
    const n = this.offsets.length;
    if (n === 0) {
      return {
        count: 0,
        lastMs: null,
        minMs: null,
        avgMs: null,
        p90Ms: null,
        p99Ms: null,
        maxMs: null,
        unmatchedVideo: this.pendingVideo.length,
        unmatchedAudio: this.pendingAudio.length,
      };
    }
    const sorted = [...this.offsets].sort((a, b) => a - b);
    const sum = this.offsets.reduce((acc, v) => acc + v, 0);
    return {
      count: n,
      lastMs: this.last,
      minMs: sorted[0],
      avgMs: sum / n,
      p90Ms: percentile(sorted, 90),
      p99Ms: percentile(sorted, 99),
      maxMs: sorted[n - 1],
      unmatchedVideo: this.pendingVideo.length,
      unmatchedAudio: this.pendingAudio.length,
    };
  }

  reset(): void {
    this.videoBaseline = 0;
    this.audioBaseline = 0;
    this.videoArmed = true;
    this.audioArmed = true;
    this.pendingVideo = [];
    this.pendingAudio = [];
    this.offsets.length = 0;
    this.last = null;
  }
}
