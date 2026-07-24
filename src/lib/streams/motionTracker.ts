/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer — "follow activity" motion detection.
 *
 * Given consecutive packed 4bpp VIC frames (two pixels per byte: low nibble =
 * left pixel, high nibble = right), {@link MotionTracker} reports where the
 * screen is changing — a blinking cursor, typing, a moving sprite — as a
 * normalized centroid and bounding box the mirror can pan/zoom toward. Pure,
 * side-effect-free math: no React, no DOM.
 *
 * Note on `changedPixels`: comparison is byte-granular (each byte packs two
 * pixels), so a differing byte is counted once at its left-pixel coordinate.
 * `changedPixels` is therefore the number of differing sampled bytes — a
 * conservative proxy for the true (up to 2×) changed-pixel count.
 */

import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";

export interface MotionResult {
  changed: boolean;
  centroid: { x: number; y: number } | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  changedPixels: number;
}

export interface MotionTrackerOptions {
  sampleStep?: number;
  minChangedPixels?: number;
}

const EMPTY_RESULT = (changedPixels: number): MotionResult => ({
  changed: false,
  centroid: null,
  bbox: null,
  changedPixels,
});

export class MotionTracker {
  private readonly sampleStep: number;
  private readonly minChangedPixels: number;
  private prev: Uint8Array | null = null;

  constructor(options?: MotionTrackerOptions) {
    const step = options?.sampleStep;
    this.sampleStep = typeof step === "number" && Number.isFinite(step) && step >= 1 ? Math.floor(step) : 2;
    const min = options?.minChangedPixels;
    this.minChangedPixels = typeof min === "number" && Number.isFinite(min) && min >= 0 ? min : 8;
  }

  /** Forget the previous frame; the next {@link update} restarts the baseline. */
  reset(): void {
    this.prev = null;
  }

  update(frame: Uint8Array, width: number = VIC_FRAME_WIDTH, height: number = VIC_PAL_HEIGHT): MotionResult {
    const prev = this.prev;

    // First frame, or a size/format change: adopt as the new baseline, no motion.
    if (prev === null || prev.length !== frame.length) {
      this.prev = frame.slice();
      return EMPTY_RESULT(0);
    }

    const step = this.sampleStep;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < frame.length; i += step) {
      if (frame[i] !== prev[i]) {
        const pixelIndex = i * 2;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        count++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    // Adopt the new frame as the next baseline (copy — the caller may reuse its buffer).
    this.prev = frame.slice();

    if (count < this.minChangedPixels) {
      return EMPTY_RESULT(count);
    }

    return {
      changed: true,
      centroid: { x: sumX / count / width, y: sumY / count / height },
      bbox: {
        x: minX / width,
        y: minY / height,
        w: (maxX - minX + 1) / width,
        h: (maxY - minY + 1) / height,
      },
      changedPixels: count,
    };
  }
}
