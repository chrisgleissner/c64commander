/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { MotionTracker } from "@/lib/streams/motionTracker";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";

const W = VIC_FRAME_WIDTH; // 384
const H = VIC_PAL_HEIGHT; // 272
const BYTES_PER_ROW = W / 2; // 192 packed bytes per scanline
const FRAME_BYTES = (W * H) / 2; // 52224

/** Packed-byte index for scanline `row`, byte-column `col`. */
const byteIndex = (row: number, col: number): number => row * BYTES_PER_ROW + col;

const blankFrame = (): Uint8Array => new Uint8Array(FRAME_BYTES);

/** Flip an inclusive rectangle of packed bytes to a distinct value. */
const flipRect = (frame: Uint8Array, row0: number, row1: number, col0: number, col1: number, value = 0xff): void => {
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      frame[byteIndex(r, c)] = value;
    }
  }
};

describe("MotionTracker.update — baseline behavior", () => {
  it("first frame reports no motion", () => {
    const tracker = new MotionTracker();
    const res = tracker.update(blankFrame());
    expect(res).toEqual({ changed: false, centroid: null, bbox: null, changedPixels: 0 });
  });

  it("identical consecutive frames report no motion", () => {
    const tracker = new MotionTracker();
    const a = blankFrame();
    tracker.update(a);
    const res = tracker.update(a.slice());
    expect(res.changed).toBe(false);
    expect(res.centroid).toBeNull();
    expect(res.bbox).toBeNull();
    expect(res.changedPixels).toBe(0);
  });
});

describe("MotionTracker.update — localized change", () => {
  it("detects a localized change with centroid near the region and a bounding bbox", () => {
    // sampleStep 1 so every byte in the region is counted (deterministic math).
    const tracker = new MotionTracker({ sampleStep: 1 });
    tracker.update(blankFrame());

    const next = blankFrame();
    // rows 100..109, byte-cols 50..69 -> pixel x = 2*col, y = row.
    flipRect(next, 100, 109, 50, 69);
    const res = tracker.update(next);

    expect(res.changed).toBe(true);
    // 10 rows * 20 cols = 200 differing bytes.
    expect(res.changedPixels).toBe(200);

    // centroid: mean col = 59.5 -> x = 119; mean row = 104.5.
    expect(res.centroid).not.toBeNull();
    expect(res.centroid!.x).toBeCloseTo(119 / W, 6);
    expect(res.centroid!.y).toBeCloseTo(104.5 / H, 6);

    // bbox: x in [100,138] (cols 50..69 -> 2*col), y in [100,109].
    expect(res.bbox).not.toBeNull();
    expect(res.bbox!.x).toBeCloseTo(100 / W, 6);
    expect(res.bbox!.y).toBeCloseTo(100 / H, 6);
    expect(res.bbox!.w).toBeCloseTo((138 - 100 + 1) / W, 6);
    expect(res.bbox!.h).toBeCloseTo((109 - 100 + 1) / H, 6);

    // The centroid must lie inside the reported bbox.
    expect(res.centroid!.x).toBeGreaterThanOrEqual(res.bbox!.x);
    expect(res.centroid!.x).toBeLessThanOrEqual(res.bbox!.x + res.bbox!.w);
    expect(res.centroid!.y).toBeGreaterThanOrEqual(res.bbox!.y);
    expect(res.centroid!.y).toBeLessThanOrEqual(res.bbox!.y + res.bbox!.h);
  });

  it("centroid tracks the region: a change in the bottom-right yields large normalized coords", () => {
    const tracker = new MotionTracker({ sampleStep: 1 });
    tracker.update(blankFrame());
    const next = blankFrame();
    // near bottom-right: rows 250..260, cols 170..190 (x = 2*col up to 380).
    flipRect(next, 250, 260, 170, 190);
    const res = tracker.update(next);
    expect(res.changed).toBe(true);
    expect(res.centroid!.x).toBeGreaterThan(0.85);
    expect(res.centroid!.y).toBeGreaterThan(0.9);
  });
});

describe("MotionTracker.update — thresholding", () => {
  it("ignores a change below minChangedPixels", () => {
    const tracker = new MotionTracker(); // minChangedPixels 8, sampleStep 2
    tracker.update(blankFrame());
    const next = blankFrame();
    // Flip 4 even-index bytes (all sampled) -> count 4 < 8.
    next[0] = 0xff;
    next[2] = 0xff;
    next[4] = 0xff;
    next[6] = 0xff;
    const res = tracker.update(next);
    expect(res.changed).toBe(false);
    expect(res.centroid).toBeNull();
    expect(res.bbox).toBeNull();
    expect(res.changedPixels).toBe(4);
  });

  it("honors a custom minChangedPixels", () => {
    const tracker = new MotionTracker({ sampleStep: 1, minChangedPixels: 3 });
    tracker.update(blankFrame());
    const next = blankFrame();
    next[10] = 0xff;
    next[11] = 0xff;
    next[12] = 0xff;
    const res = tracker.update(next);
    expect(res.changed).toBe(true);
    expect(res.changedPixels).toBe(3);
  });
});

describe("MotionTracker.update — sampleStep", () => {
  it("misses a change that falls only on skipped bytes", () => {
    const tracker = new MotionTracker({ sampleStep: 4 });
    tracker.update(blankFrame());
    const next = blankFrame();
    // Indices 1,2,3,5,6,7 are never multiples of 4 -> never sampled.
    for (const i of [1, 2, 3, 5, 6, 7]) next[i] = 0xff;
    const res = tracker.update(next);
    expect(res.changed).toBe(false);
    expect(res.changedPixels).toBe(0);
  });

  it("detects the same change when every byte is sampled (sampleStep 1)", () => {
    const tracker = new MotionTracker({ sampleStep: 1, minChangedPixels: 4 });
    tracker.update(blankFrame());
    const next = blankFrame();
    for (const i of [1, 2, 3, 5, 6, 7]) next[i] = 0xff;
    const res = tracker.update(next);
    expect(res.changed).toBe(true);
    expect(res.changedPixels).toBe(6);
  });

  it("samples every Nth byte for a dense change (sampleStep 2 halves the count)", () => {
    const tracker = new MotionTracker({ sampleStep: 2, minChangedPixels: 1 });
    tracker.update(blankFrame());
    const next = blankFrame();
    // Flip a contiguous run of 20 bytes (indices 0..19) -> even indices sampled = 10.
    for (let i = 0; i < 20; i++) next[i] = 0xff;
    const res = tracker.update(next);
    expect(res.changed).toBe(true);
    expect(res.changedPixels).toBe(10);
  });
});

describe("MotionTracker.reset", () => {
  it("clears the previous frame so the next update restarts the baseline", () => {
    const tracker = new MotionTracker({ sampleStep: 1, minChangedPixels: 4 });
    const a = blankFrame();
    tracker.update(a);

    const b = blankFrame();
    flipRect(b, 10, 20, 10, 20);
    expect(tracker.update(b).changed).toBe(true);

    tracker.reset();
    // After reset, feeding b again is a first frame -> no motion.
    const afterReset = tracker.update(b);
    expect(afterReset.changed).toBe(false);
    expect(afterReset.changedPixels).toBe(0);
  });
});

describe("MotionTracker.update — frame size / format change", () => {
  it("treats a differing frame length as a reset without throwing", () => {
    const tracker = new MotionTracker({ sampleStep: 1, minChangedPixels: 1 });
    const small = new Uint8Array(1000);
    tracker.update(small);

    const big = new Uint8Array(FRAME_BYTES);
    big[0] = 0xff;
    let res: ReturnType<MotionTracker["update"]>;
    expect(() => {
      res = tracker.update(big, W, H);
    }).not.toThrow();
    // Size change => adopted as new baseline, no motion reported.
    expect(res!.changed).toBe(false);
    expect(res!.changedPixels).toBe(0);

    // The big frame is now the baseline; a further change against it is detected.
    const big2 = big.slice();
    big2[10] = 0xff;
    const res2 = tracker.update(big2, W, H);
    expect(res2.changed).toBe(true);
    expect(res2.changedPixels).toBe(1);
  });
});

describe("MotionTracker.update — custom dimensions", () => {
  it("normalizes coordinates by the passed width/height", () => {
    const w = 8;
    const h = 4;
    const bytes = (w * h) / 2; // 16 bytes
    const tracker = new MotionTracker({ sampleStep: 1, minChangedPixels: 1 });
    tracker.update(new Uint8Array(bytes), w, h);
    const next = new Uint8Array(bytes);
    // byte 0 -> pixelIndex 0 -> x 0, y 0.
    next[0] = 0xff;
    const res = tracker.update(next, w, h);
    expect(res.changed).toBe(true);
    expect(res.centroid!.x).toBeCloseTo(0, 12);
    expect(res.centroid!.y).toBeCloseTo(0, 12);
    expect(res.bbox!.w).toBeCloseTo(1 / w, 12);
    expect(res.bbox!.h).toBeCloseTo(1 / h, 12);
  });
});
