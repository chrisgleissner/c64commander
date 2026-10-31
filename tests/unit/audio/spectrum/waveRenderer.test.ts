/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  WAVE_POINTS,
  WaveTrace,
  decodeWave,
  drawWave,
  drawWaveBackdrop,
  type WaveTrace as WaveTraceType,
} from "@/lib/audio/spectrum/waveRenderer";
import { computeLayout, type FrameDrawOptions, type SpectrumLayout } from "@/lib/audio/spectrum/spectrumRenderer";
import type { SpectrumPalette } from "@/lib/audio/spectrum/spectrumColors";
import type { SpectrumTier } from "@/lib/audio/spectrum/spectrumQuality";

const palette = {
  dark: true,
  steps: [{ db: -60, color: "#00ff00" }],
  panel: "#101010",
  border: "#202020",
  grid: "rgba(1,2,3,0.12)",
  gridZero: "rgba(1,2,3,0.32)",
  label: "#aaaaaa",
  cap: "#f0f0f0",
  fontFamily: "sans-serif",
  fontPx: 14,
} as SpectrumPalette;

const encode = (values: number[]): string => {
  const bytes = new Int8Array(WAVE_POINTS);
  values.forEach((value, index) => {
    bytes[index] = value;
  });
  return btoa(String.fromCharCode(...new Uint8Array(bytes.buffer)));
};

interface Stroke {
  style: unknown;
  alpha: number;
  moves: Array<[number, number]>;
  lines: Array<[number, number]>;
}

const makeContext = () => {
  const strokes: Stroke[] = [];
  let current: Stroke = { style: "", alpha: 1, moves: [], lines: [] };
  const ctx = {
    strokeStyle: "" as unknown,
    globalAlpha: 1,
    lineWidth: 1,
    lineJoin: "",
    beginPath: vi.fn(() => {
      current = { style: "", alpha: 1, moves: [], lines: [] };
    }),
    moveTo: vi.fn((x: number, y: number) => current.moves.push([x, y])),
    lineTo: vi.fn((x: number, y: number) => current.lines.push([x, y])),
    stroke: vi.fn(() => {
      strokes.push({ ...current, style: ctx.strokeStyle, alpha: ctx.globalAlpha });
    }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
};

const optionsFor = (layout: SpectrumLayout): FrameDrawOptions => ({
  layout,
  palette,
  tier: { index: 2 } as SpectrumTier,
  gradient: null,
  glow: false,
  ratio: 1,
});

const traceOf = (values: number[], triggered: boolean): WaveTraceType => {
  const trace = new WaveTrace();
  trace.update({ wave: encode(values), waveTriggered: triggered });
  return trace;
};

describe("waveRenderer", () => {
  const layout = computeLayout(300, 194, 14);
  const plotHeight = layout.plotBottom - layout.plotTop;
  const centre = layout.plotTop + plotHeight / 2;

  beforeEach(() => {
    vi.mocked(addLog).mockClear();
  });

  it("decodes a base64 signed byte array into its 256 points", () => {
    const out = new Int8Array(WAVE_POINTS);
    decodeWave(encode([127, -127, 0, 64, -64]), out);
    expect(Array.from(out.slice(0, 5))).toEqual([127, -127, 0, 64, -64]);
    expect(out[255]).toBe(0);
  });

  it("throws for a string that is not base64 or not 256 bytes long, and keeps the previous points", () => {
    const out = new Int8Array(WAVE_POINTS).fill(5);
    expect(() => decodeWave("not base64!", out)).toThrow(/not valid base64/);
    expect(() => decodeWave(btoa("short"), out)).toThrow(/5 points, expected 256/);
    expect(out.every((value) => value === 5)).toBe(true);
  });

  it("logs a malformed wave once and keeps drawing the last good one", () => {
    const trace = traceOf([100], true);
    trace.update({ wave: "!!", waveTriggered: true });
    trace.update({ wave: "!!", waveTriggered: true });
    expect(trace.points[0]).toBe(100);
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addLog).mock.calls[0][0]).toBe("warn");
  });

  it("scales full scale to the top and bottom of the plot and zero to its middle", () => {
    const values = new Array(WAVE_POINTS).fill(0);
    values[0] = 127;
    values[1] = -127;
    const { ctx, strokes } = makeContext();
    drawWave(ctx, optionsFor(layout), traceOf(values, true));
    const trace = strokes[strokes.length - 1];
    const path = [...trace.moves, ...trace.lines];
    expect(trace.moves[0]).toEqual([layout.plotLeft, layout.plotTop]);
    expect(trace.lines[0][1]).toBeCloseTo(layout.plotBottom, 5);
    expect(trace.lines[1][1]).toBeCloseTo(centre, 5);
    expect(path).toHaveLength(WAVE_POINTS);
    expect(trace.lines[WAVE_POINTS - 2][0]).toBeCloseTo(layout.plotRight, 5);
  });

  it("clamps a point outside the byte range instead of drawing outside the plot", () => {
    const { ctx, strokes } = makeContext();
    const trace = new WaveTrace();
    trace.points[0] = -128;
    drawWave(ctx, optionsFor(layout), trace);
    expect(strokes[strokes.length - 1].moves[0][1]).toBeCloseTo(layout.plotBottom, 5);
  });

  it("strokes a triggered wave in the foreground colour at full strength and an untriggered one dimmer", () => {
    const triggered = makeContext();
    drawWave(triggered.ctx, optionsFor(layout), traceOf([50, -50], true));
    const loose = makeContext();
    drawWave(loose.ctx, optionsFor(layout), traceOf([50, -50], false));
    const solid = triggered.strokes[triggered.strokes.length - 1];
    const dim = loose.strokes[loose.strokes.length - 1];
    expect(solid.style).toBe(palette.cap);
    expect(dim.style).toBe(palette.cap);
    expect(solid.alpha).toBe(1);
    expect(dim.alpha).toBeLessThan(solid.alpha);
    expect(dim.alpha).toBeGreaterThan(0);
  });

  it("restores full opacity after a dim stroke so later drawing is not faded", () => {
    const { ctx } = makeContext();
    drawWave(ctx, optionsFor(layout), traceOf([50], false));
    expect(ctx.globalAlpha).toBe(1);
  });

  it("clears to a flat line that is not triggered", () => {
    const trace = traceOf([90, -90], true);
    trace.clear();
    expect(trace.points.every((value) => value === 0)).toBe(true);
    expect(trace.triggered).toBe(false);
  });

  it("keeps the last wave when a frame carries none, as an older bridge does", () => {
    const trace = traceOf([42], true);
    trace.update({});
    expect(trace.points[0]).toBe(42);
  });

  it("draws a faint centre line across the plot behind the trace", () => {
    const { ctx, strokes } = makeContext();
    drawWaveBackdrop(ctx, layout, palette);
    const line = strokes[strokes.length - 1];
    expect(line.style).toBe(palette.grid);
    expect(line.moves[0][1]).toBeCloseTo(centre, 5);
    expect(line.moves[0][0]).toBe(layout.plotLeft);
    expect(line.lines[0][0]).toBe(layout.plotRight);
    expect(line.lines[0][1]).toBeCloseTo(centre, 5);
  });
});
