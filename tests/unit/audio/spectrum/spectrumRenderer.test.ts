/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

import { createBallistics } from "@/lib/audio/spectrum/spectrumBallistics";
import { levelColorSteps, type SpectrumPalette } from "@/lib/audio/spectrum/spectrumColors";
import { SPECTRUM_TIERS } from "@/lib/audio/spectrum/spectrumQuality";
import {
  MINOR_LABELS_MIN_PLOT_PX,
  computeLayout,
  devicePixelRatioFor,
  drawBars,
  drawMeters,
  createMeterGradient,
  METER_HEIGHT_PX,
  METER_AREA_HEIGHT_PX,
  drawStaticLayer,
  type FrameDrawOptions,
  type SpectrumContext,
} from "@/lib/audio/spectrum/spectrumRenderer";

const palette: SpectrumPalette = {
  dark: true,
  steps: levelColorSteps(true),
  panel: "panel",
  border: "border",
  grid: "grid",
  gridZero: "gridZero",
  label: "label",
  cap: "cap",
  fontFamily: "sans-serif",
  fontPx: 14,
};

const makeContext = () => {
  const fills: Array<{ style: unknown; x: number; y: number; w: number; h: number; alpha: number }> = [];
  const ctx = {
    fillStyle: "" as unknown,
    globalAlpha: 1,
    fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
      fills.push({ style: ctx.fillStyle, x, y, w, h, alpha: ctx.globalAlpha }),
    ),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(),
  };
  return { ctx: ctx as unknown as SpectrumContext, fills, raw: ctx };
};

const options = (tierIndex: 0 | 1 | 2 | 3, glow: boolean, gradient: CanvasGradient | null): FrameDrawOptions => ({
  layout: computeLayout(300, 150, palette.fontPx),
  palette,
  tier: SPECTRUM_TIERS[tierIndex],
  gradient,
  glow,
  ratio: 1,
});

const stateWith = (bars: number, level: number, peak: number) => {
  const state = createBallistics(bars);
  state.levels.fill(level);
  state.peaks.fill(peak);
  return state;
};

describe("spectrum renderer", () => {
  it("pads the labels and the plot equally from the left and right edges", () => {
    for (const [width, fontPx] of [
      [192, 14],
      [300, 14],
      [420, 16],
    ]) {
      const layout = computeLayout(width, 234, fontPx);
      const labelStart = layout.plotLeft - 5 - Math.ceil(fontPx * 1.45);
      expect(layout.width - layout.plotRight).toBe(labelStart);
    }
  });

  it("stacks left and right channel meters above the frequency plot with a dB scale that rises from left to right", () => {
    const t = makeContext();
    const layout = computeLayout(300, 234, 14);
    drawStaticLayer(t.ctx, layout, palette, 1);
    expect(layout.plotTop).toBeGreaterThan(METER_AREA_HEIGHT_PX);
    const labels = t.raw.fillText.mock.calls;
    expect(labels).toContainEqual(["L", layout.plotLeft - 6, 17]);
    expect(labels).toContainEqual(["R", layout.plotLeft - 6, 41]);
    const scale = labels.filter(([, , y]) => y === 64);
    expect(scale.map(([text]) => text)).toEqual(["0", "-20", "-40", "-60"]);
    expect(scale[0][1]).toBeGreaterThan(scale.at(-1)![1]);
    expect(labels.some(([text]) => text === "Hz")).toBe(true);
  });

  it("grows both meters from the left edge toward 0 dBFS on the right and places held caps at their higher peaks", () => {
    const t = makeContext();
    const opts = options(1, false, null);
    const state = createBallistics(4);
    state.levels.set([-36, -24, -18, -12]);
    state.peaks.set([-30, -18, -16, -6]);
    const gradient = {} as CanvasGradient;
    drawMeters(t.ctx, opts, state, gradient);
    const bars = t.fills.filter((f) => f.style === gradient && f.alpha === 1);
    const extensions = t.fills.filter((f) => f.alpha === 0.45);
    expect(extensions).toHaveLength(2);
    expect(t.raw.globalAlpha).toBe(1);
    const caps = t.fills.filter((f) => f.style === palette.cap);
    expect(bars).toHaveLength(2);
    expect(bars[0].y).toBeLessThan(bars[1].y);
    for (let i = 0; i < 2; i++) {
      expect(bars[i].x).toBeCloseTo(opts.layout.plotLeft);
      expect(bars[i].h).toBe(METER_HEIGHT_PX);
      expect(caps[i].x + caps[i].w).toBeGreaterThanOrEqual(extensions[i].x + extensions[i].w);
      expect(extensions[i].x).toBeCloseTo(bars[i].x + bars[i].w);
    }
    expect(bars[1].w).toBeGreaterThan(bars[0].w);
  });

  it("clamps meter overrange and silence, omits floor caps, and supports flat colours", () => {
    const t = makeContext();
    const opts = options(3, false, null);
    const state = createBallistics(4);
    state.levels.set([12, 12, -100, -100]);
    state.peaks.set([12, 12, -100, -100]);
    drawMeters(t.ctx, opts, state, null);
    expect(t.fills).toHaveLength(2);
    expect(t.fills[0].x).toBe(opts.layout.plotLeft);
    expect(t.fills[0].w).toBe(opts.layout.plotRight - opts.layout.plotLeft);
    expect(t.fills[1].x + t.fills[1].w).toBe(opts.layout.plotRight);
  });

  it("uses the spectrum colour ramp from the quiet left edge towards the loud right edge", () => {
    const t = makeContext();
    const gradient = { addColorStop: vi.fn() };
    t.raw.createLinearGradient.mockReturnValue(gradient);
    const layout = computeLayout(300, 234, 14);
    expect(createMeterGradient(t.ctx, layout, palette)).toBe(gradient);
    expect(t.raw.createLinearGradient).toHaveBeenCalledWith(layout.plotLeft, 0, layout.plotRight, 0);
    expect(gradient.addColorStop).toHaveBeenCalledTimes(palette.steps.length);
  });

  it("limits the device pixel ratio to between 1 and 2 and treats an unusable ratio as 1", () => {
    expect(devicePixelRatioFor(3)).toBe(2);
    expect(devicePixelRatioFor(1.5)).toBe(1.5);
    expect(devicePixelRatioFor(0.5)).toBe(1);
    expect(devicePixelRatioFor(0)).toBe(1);
    expect(devicePixelRatioFor(Number.NaN)).toBe(1);
  });

  it("labels the minor frequencies only when the plot is wide enough", () => {
    const narrow = makeContext();
    const wide = makeContext();
    const narrowLayout = computeLayout(MINOR_LABELS_MIN_PLOT_PX - 50, 150, 14);
    const wideLayout = computeLayout(MINOR_LABELS_MIN_PLOT_PX + 200, 150, 14);
    expect(narrowLayout.showMinorLabels).toBe(false);
    expect(wideLayout.showMinorLabels).toBe(true);
    drawStaticLayer(narrow.ctx, narrowLayout, palette, 1);
    drawStaticLayer(wide.ctx, wideLayout, palette, 1);
    const labels = (raw: ReturnType<typeof makeContext>["raw"]) => raw.fillText.mock.calls.map(([text]) => text);
    expect(labels(narrow.raw)).toEqual(expect.arrayContaining(["100", "1k", "10k"]));
    expect(labels(narrow.raw)).not.toContain("500");
    expect(labels(wide.raw)).toEqual(expect.arrayContaining(["50", "500", "5k"]));
  });

  it("fills each bar with the gradient on a tier that has one and adds a glow only when asked", () => {
    const gradient = {} as CanvasGradient;
    const plain = makeContext();
    drawBars(plain.ctx, options(1, false, gradient), stateWith(48, -20, -10));
    expect(plain.fills.some((f) => f.alpha < 1)).toBe(false);
    expect(plain.fills.filter((f) => f.style === gradient)).toHaveLength(48);

    const glowing = makeContext();
    drawBars(glowing.ctx, options(0, true, gradient), stateWith(48, -20, -10));
    const glow = glowing.fills.filter((f) => f.alpha === 0.2);
    expect(glow).toHaveLength(48);
    expect(glowing.raw.globalAlpha).toBe(1);
    expect(glowing.fills.filter((f) => f.style === gradient && f.alpha === 1)).toHaveLength(48);
  });

  it("skips the glow of a bar too short to show", () => {
    const glowing = makeContext();
    drawBars(glowing.ctx, options(0, true, {} as CanvasGradient), stateWith(48, -100, -100));
    expect(glowing.fills).toEqual([]);
  });

  it("draws flat colour steps on the lowest tier and stops at the bar top", () => {
    const flat = makeContext();
    const loud = options(3, false, null);
    drawBars(flat.ctx, loud, stateWith(12, 0, 0));
    const barFills = flat.fills.filter((f) => f.style !== palette.cap);
    expect(new Set(barFills.map((f) => f.style)).size).toBeGreaterThan(3);

    const quiet = makeContext();
    drawBars(quiet.ctx, loud, stateWith(12, -50, -50));
    const quietBars = quiet.fills.filter((f) => f.style !== palette.cap);
    expect(quietBars.length).toBeGreaterThan(0);
    expect(quietBars.length).toBeLessThan(barFills.length);
  });

  it("falls back to flat bars when the tier wants a gradient but none was built", () => {
    const t = makeContext();
    drawBars(t.ctx, options(0, false, null), stateWith(48, -20, -10));
    expect(t.fills.some((f) => typeof f.style === "string" && f.style !== palette.cap)).toBe(true);
  });

  it("narrows the gap between bars as the bar count rises", () => {
    const widths = ([12, 24, 48] as const).map((bars) => {
      const t = makeContext();
      const tier = SPECTRUM_TIERS[bars === 12 ? 3 : bars === 24 ? 2 : 1];
      const layout = computeLayout(300, 150, palette.fontPx);
      drawBars(t.ctx, { ...options(1, false, {} as CanvasGradient), layout, tier }, stateWith(bars, -20, -100));
      const pitch = (layout.plotRight - layout.plotLeft) / bars;
      return pitch - t.fills[0].w;
    });
    [3, 2, 1].forEach((expected, i) => expect(Math.abs(widths[i] - expected)).toBeLessThanOrEqual(0.75));
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  it("omits the peak cap of a bar whose peak is at the floor", () => {
    const t = makeContext();
    drawBars(t.ctx, options(1, false, {} as CanvasGradient), stateWith(48, -100, -100));
    expect(t.fills.filter((f) => f.style === palette.cap)).toEqual([]);
    const capped = makeContext();
    drawBars(capped.ctx, options(1, false, {} as CanvasGradient), stateWith(48, -100, -10));
    expect(capped.fills.filter((f) => f.style === palette.cap)).toHaveLength(48);
  });
});
