/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  FIT_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  type Viewport,
  clampViewport,
  panViewport,
  setCenter,
  viewportRect,
  viewportTransform,
  zoomViewport,
} from "@/lib/streams/mirrorViewport";

describe("mirrorViewport constants", () => {
  it("exposes the documented scale bounds and fit viewport", () => {
    expect(MIN_SCALE).toBe(1);
    expect(MAX_SCALE).toBe(8);
    expect(FIT_VIEWPORT).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
  });
});

describe("clampViewport", () => {
  it("forces the center to (0.5, 0.5) at scale 1", () => {
    expect(clampViewport({ scale: 1, cx: 0.1, cy: 0.9 })).toEqual({ scale: 1, cx: 0.5, cy: 0.5 });
  });

  it("keeps a zoomed viewport inside [0,1] (scale 2, cx 0.9 -> 0.75)", () => {
    const v = clampViewport({ scale: 2, cx: 0.9, cy: 0.9 });
    expect(v.scale).toBe(2);
    expect(v.cx).toBeCloseTo(0.75, 12);
    expect(v.cy).toBeCloseTo(0.75, 12);
  });

  it("clamps low centers up to the half-extent", () => {
    const v = clampViewport({ scale: 4, cx: 0, cy: 0 });
    // half-extent = 0.5/4 = 0.125
    expect(v.cx).toBeCloseTo(0.125, 12);
    expect(v.cy).toBeCloseTo(0.125, 12);
  });

  it("clamps scale below MIN_SCALE up to MIN_SCALE", () => {
    expect(clampViewport({ scale: 0.25, cx: 0.5, cy: 0.5 }).scale).toBe(MIN_SCALE);
  });

  it("clamps scale above MAX_SCALE down to MAX_SCALE", () => {
    const v = clampViewport({ scale: 100, cx: 0.5, cy: 0.5 });
    expect(v.scale).toBe(MAX_SCALE);
  });

  it("preserves in-range floats without rounding", () => {
    const v = clampViewport({ scale: 2.5, cx: 0.4321, cy: 0.5678 });
    expect(v).toEqual({ scale: 2.5, cx: 0.4321, cy: 0.5678 });
  });

  it("guards NaN and Infinity components -> FIT_VIEWPORT", () => {
    expect(clampViewport({ scale: NaN, cx: 0.5, cy: 0.5 })).toEqual(FIT_VIEWPORT);
    expect(clampViewport({ scale: 2, cx: Infinity, cy: 0.5 })).toEqual(FIT_VIEWPORT);
    expect(clampViewport({ scale: 2, cx: 0.5, cy: -Infinity })).toEqual(FIT_VIEWPORT);
    expect(clampViewport({ scale: 2, cx: NaN, cy: NaN })).toEqual(FIT_VIEWPORT);
  });

  it("does not return the shared FIT_VIEWPORT reference on the guard path", () => {
    const guarded = clampViewport({ scale: NaN, cx: 0, cy: 0 });
    expect(guarded).not.toBe(FIT_VIEWPORT);
  });
});

describe("zoomViewport", () => {
  it("zooming about the center leaves cx,cy unchanged", () => {
    const v = zoomViewport({ scale: 1, cx: 0.5, cy: 0.5 }, 2);
    expect(v.scale).toBe(2);
    expect(v.cx).toBeCloseTo(0.5, 12);
    expect(v.cy).toBeCloseTo(0.5, 12);
  });

  it("zooming about an off-center focus keeps that focus point fixed on screen", () => {
    // Start fit (scale 1, center 0.5). Focus at (0.75, 0.25).
    const focus = { x: 0.75, y: 0.25 };
    const start: Viewport = { scale: 1, cx: 0.5, cy: 0.5 };
    const zoomed = zoomViewport(start, 2, focus);
    expect(zoomed.scale).toBe(2);

    // The focus point's screen position must be invariant. Screen position of a
    // normalized frame point p under viewport v is s = 0.5 + v.scale*(p - v.cx).
    const screen = (p: number, s: number, c: number) => 0.5 + s * (p - c);
    expect(screen(focus.x, start.scale, start.cx)).toBeCloseTo(screen(focus.x, zoomed.scale, zoomed.cx), 12);
    expect(screen(focus.y, start.scale, start.cy)).toBeCloseTo(screen(focus.y, zoomed.scale, zoomed.cy), 12);

    // Concretely: cx_new = 0.75 + (0.5 - 0.75) * (1/2) = 0.625
    expect(zoomed.cx).toBeCloseTo(0.625, 12);
    // cy_new = 0.25 + (0.5 - 0.25) * (1/2) = 0.375
    expect(zoomed.cy).toBeCloseTo(0.375, 12);
  });

  it("focus invariance survives a second zoom step at an already-zoomed state", () => {
    const focus = { x: 0.8, y: 0.2 };
    const start: Viewport = { scale: 2, cx: 0.5, cy: 0.5 };
    const zoomed = zoomViewport(start, 2, focus);
    const screen = (p: number, s: number, c: number) => 0.5 + s * (p - c);
    // Only valid to compare when clamping did not kick in; verify no clamp happened.
    const half = 0.5 / zoomed.scale;
    expect(zoomed.cx).toBeGreaterThanOrEqual(half - 1e-9);
    expect(zoomed.cx).toBeLessThanOrEqual(1 - half + 1e-9);
    expect(screen(focus.x, start.scale, start.cx)).toBeCloseTo(screen(focus.x, zoomed.scale, zoomed.cx), 12);
    expect(screen(focus.y, start.scale, start.cy)).toBeCloseTo(screen(focus.y, zoomed.scale, zoomed.cy), 12);
  });

  it("zooming back out to scale 1 returns to the center", () => {
    const zoomedIn = zoomViewport({ scale: 1, cx: 0.5, cy: 0.5 }, 4, { x: 0.9, y: 0.1 });
    expect(zoomedIn.scale).toBe(4);
    const back = zoomViewport(zoomedIn, 0.25); // 4 * 0.25 = 1
    expect(back.scale).toBe(MIN_SCALE);
    expect(back.cx).toBeCloseTo(0.5, 12);
    expect(back.cy).toBeCloseTo(0.5, 12);
  });

  it("clamps the new scale to MAX_SCALE and stays in-frame", () => {
    const v = zoomViewport({ scale: 4, cx: 0.5, cy: 0.5 }, 100, { x: 0.9, y: 0.9 });
    expect(v.scale).toBe(MAX_SCALE);
    const half = 0.5 / v.scale;
    expect(v.cx).toBeGreaterThanOrEqual(half - 1e-9);
    expect(v.cx).toBeLessThanOrEqual(1 - half + 1e-9);
  });

  it("defaults the focus to the current center when none is given", () => {
    const v: Viewport = { scale: 2, cx: 0.6, cy: 0.4 };
    const zoomed = zoomViewport(v, 1.5);
    expect(zoomed.cx).toBeCloseTo(0.6, 12);
    expect(zoomed.cy).toBeCloseTo(0.4, 12);
  });

  it("guards a non-finite factor by returning the clamped input", () => {
    const v: Viewport = { scale: 2, cx: 0.6, cy: 0.4 };
    expect(zoomViewport(v, NaN)).toEqual(clampViewport(v));
  });
});

describe("panViewport", () => {
  it("pans the center by normalized deltas", () => {
    const v = panViewport({ scale: 2, cx: 0.5, cy: 0.5 }, 0.1, -0.1);
    expect(v.cx).toBeCloseTo(0.6, 12);
    expect(v.cy).toBeCloseTo(0.4, 12);
  });

  it("re-clamps a pan that would leave the frame", () => {
    // scale 2 -> valid center range [0.25, 0.75].
    const v = panViewport({ scale: 2, cx: 0.7, cy: 0.3 }, 0.5, -0.5);
    expect(v.cx).toBeCloseTo(0.75, 12);
    expect(v.cy).toBeCloseTo(0.25, 12);
  });

  it("cannot move the center at scale 1", () => {
    const v = panViewport({ scale: 1, cx: 0.5, cy: 0.5 }, 0.3, 0.3);
    expect(v.cx).toBe(0.5);
    expect(v.cy).toBe(0.5);
  });
});

describe("setCenter", () => {
  it("sets and clamps the center", () => {
    const v = setCenter({ scale: 2, cx: 0.5, cy: 0.5 }, 0.9, 0.1);
    expect(v.cx).toBeCloseTo(0.75, 12);
    expect(v.cy).toBeCloseTo(0.25, 12);
    expect(v.scale).toBe(2);
  });
});

describe("viewportRect", () => {
  it("scale 2 centered -> {0.25, 0.25, 0.5, 0.5}", () => {
    const r = viewportRect({ scale: 2, cx: 0.5, cy: 0.5 });
    expect(r.x).toBeCloseTo(0.25, 12);
    expect(r.y).toBeCloseTo(0.25, 12);
    expect(r.w).toBeCloseTo(0.5, 12);
    expect(r.h).toBeCloseTo(0.5, 12);
  });

  it("scale 1 -> full frame {0, 0, 1, 1}", () => {
    const r = viewportRect(FIT_VIEWPORT);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(0, 12);
    expect(r.w).toBeCloseTo(1, 12);
    expect(r.h).toBeCloseTo(1, 12);
  });

  it("uses the clamped viewport (out-of-range center is corrected first)", () => {
    const r = viewportRect({ scale: 2, cx: 0.95, cy: 0.95 });
    // center clamped to 0.75 -> rect x = 0.75 - 0.25 = 0.5, right edge = 1.0
    expect(r.x).toBeCloseTo(0.5, 12);
    expect(r.x + r.w).toBeCloseTo(1, 12);
  });
});

describe("viewportTransform", () => {
  it("scale 1 centered -> no translation", () => {
    const t = viewportTransform(FIT_VIEWPORT, 800, 600);
    expect(t.scale).toBe(1);
    expect(t.translateX).toBeCloseTo(0, 9);
    expect(t.translateY).toBeCloseTo(0, 9);
  });

  it("scale 2 cx=cy=0.5 -> translate (-0.5W, -0.5H)", () => {
    const t = viewportTransform({ scale: 2, cx: 0.5, cy: 0.5 }, 800, 600);
    expect(t.scale).toBe(2);
    expect(t.translateX).toBeCloseTo(-400, 9);
    expect(t.translateY).toBeCloseTo(-300, 9);
  });

  it("keeps the viewport center at the container center", () => {
    // A frame point p maps to container px = translate + scale * p * containerW.
    // The viewport center cx must land at containerW/2.
    const v: Viewport = { scale: 3, cx: 0.4, cy: 0.6 };
    const W = 1000;
    const H = 500;
    const t = viewportTransform(v, W, H);
    const centerPxX = t.translateX + t.scale * v.cx * W;
    const centerPxY = t.translateY + t.scale * v.cy * H;
    expect(centerPxX).toBeCloseTo(W / 2, 9);
    expect(centerPxY).toBeCloseTo(H / 2, 9);
  });

  it("clamps a bad viewport before computing the transform", () => {
    const t = viewportTransform({ scale: NaN, cx: 0, cy: 0 }, 800, 600);
    expect(t.scale).toBe(1);
    expect(t.translateX).toBeCloseTo(0, 9);
    expect(t.translateY).toBeCloseTo(0, 9);
  });
});
