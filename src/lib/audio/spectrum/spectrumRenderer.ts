/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SpectrumBallisticsState } from "@/lib/audio/spectrum/spectrumBallistics";
import { colorAtLevel, type SpectrumPalette } from "@/lib/audio/spectrum/spectrumColors";
import {
  SPECTRUM_DISPLAY_MAX_DB,
  SPECTRUM_DISPLAY_MIN_DB,
  frequencyToUnit,
  levelToUnit,
} from "@/lib/audio/spectrum/spectrumBands";
import type { SpectrumTier } from "@/lib/audio/spectrum/spectrumQuality";

export type SpectrumContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const MAX_DEVICE_PIXEL_RATIO = 2;
export const GRID_LEVELS_DB = [-60, -40, -20, 0] as const;
const MAJOR_FREQUENCIES: readonly (readonly [number, string])[] = [
  [100, "100"],
  [1000, "1k"],
  [10000, "10k"],
];
const MINOR_FREQUENCIES: readonly (readonly [number, string])[] = [
  [50, "50"],
  [500, "500"],
  [5000, "5k"],
];
/** Plot width at which the minor frequency labels fit between the major ones. */
export const MINOR_LABELS_MIN_PLOT_PX = 400;
const CAP_HEIGHT_PX = 2;
export const METER_AREA_HEIGHT_PX = 84;
export const METER_HEIGHT_PX = 14;
const EDGE_PAD_PX = 8;
const LABEL_WIDTH_EM = 1.45;
const LABEL_GAP_PX = 5;
const LABEL_EDGE_SPILL_PX = 2;
const CLIP_BLOCK_PX = 6;
export const METER_SCALE_DB = [0, -20, -40, -60] as const;

export interface SpectrumLayout {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  showMinorLabels: boolean;
}

/** Splits the canvas so the labels and the plot together sit centered, with equal padding at both edges. */
export const computeLayout = (width: number, height: number, fontPx: number): SpectrumLayout => {
  const plotLeft = EDGE_PAD_PX + Math.ceil(fontPx * LABEL_WIDTH_EM) + LABEL_GAP_PX;
  const plotRight = width - EDGE_PAD_PX;
  const plotTop = METER_AREA_HEIGHT_PX + Math.ceil(fontPx / 2) + 1;
  const plotBottom = height - Math.ceil(fontPx * 1.5);
  return {
    width,
    height,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    showMinorLabels: plotRight - plotLeft >= MINOR_LABELS_MIN_PLOT_PX,
  };
};

export const devicePixelRatioFor = (raw: number): number => Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, raw || 1));

const levelY = (layout: SpectrumLayout, db: number): number =>
  layout.plotBottom - levelToUnit(db) * (layout.plotBottom - layout.plotTop);

const frequencyX = (layout: SpectrumLayout, hz: number): number =>
  layout.plotLeft + frequencyToUnit(hz) * (layout.plotRight - layout.plotLeft);

const alignToDevicePixel = (value: number, ratio: number): number => Math.round(value * ratio) / ratio;

/**
 * Draws everything that does not move: panel, gridlines and labels. It is rendered once per size or
 * theme into an offscreen canvas and copied underneath every frame.
 */
export const drawStaticLayer = (
  ctx: SpectrumContext,
  layout: SpectrumLayout,
  palette: SpectrumPalette,
  ratio: number,
  meterLabels: readonly string[] = ["L", "R"],
  withSpectrumGrid = true,
): void => {
  const { width, height } = layout;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.panel;
  ctx.fillRect(0, 0, width, height);

  ctx.font = `${palette.fontPx}px ${palette.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillStyle = palette.label;
  for (let i = 0; i < meterLabels.length; i++) {
    const y = meterLabels.length === 1 ? 22 : 10 + i * 24;
    const room = layout.plotLeft - 6 - LABEL_EDGE_SPILL_PX;
    const label = ctx.measureText(meterLabels[i]).width <= room ? meterLabels[i] : meterLabels[i][0];
    ctx.fillText(label, layout.plotLeft - 6, y + METER_HEIGHT_PX / 2);
    ctx.fillStyle = palette.grid;
    ctx.fillRect(layout.plotLeft, y, layout.plotRight - layout.plotLeft, METER_HEIGHT_PX);
    ctx.fillStyle = palette.label;
  }
  for (const db of METER_SCALE_DB) {
    const x = layout.plotLeft + levelToUnit(db) * (layout.plotRight - layout.plotLeft);
    ctx.textAlign = db === 0 ? "right" : "center";
    ctx.fillText(String(db), x, 64);
    ctx.fillStyle = palette.gridZero;
    ctx.fillRect(x, 52, 1 / ratio, 4);
    ctx.fillStyle = palette.label;
  }
  if (!withSpectrumGrid) return;

  ctx.lineWidth = 1;
  for (const db of GRID_LEVELS_DB) {
    ctx.strokeStyle = db === 0 ? palette.gridZero : palette.grid;
    const y = alignToDevicePixel(levelY(layout, db), ratio) + 0.5 / ratio;
    ctx.beginPath();
    ctx.moveTo(layout.plotLeft, y);
    ctx.lineTo(layout.plotRight, y);
    ctx.stroke();
  }
  const frequencies = layout.showMinorLabels ? [...MAJOR_FREQUENCIES, ...MINOR_FREQUENCIES] : MAJOR_FREQUENCIES;
  ctx.strokeStyle = palette.grid;
  for (const [hz] of frequencies) {
    const x = alignToDevicePixel(frequencyX(layout, hz), ratio) + 0.5 / ratio;
    ctx.beginPath();
    ctx.moveTo(x, layout.plotTop);
    ctx.lineTo(x, layout.plotBottom);
    ctx.stroke();
  }

  ctx.fillStyle = palette.label;
  ctx.font = `${palette.fontPx}px ${palette.fontFamily}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const db of GRID_LEVELS_DB) {
    const y = Math.max(palette.fontPx / 2, levelY(layout, db));
    ctx.fillText(String(db), layout.plotLeft - 5, y);
  }
  ctx.textAlign = "center";
  const labelY = layout.plotBottom + palette.fontPx * 0.9;
  ctx.textAlign = "right";
  ctx.fillText("Hz", layout.plotLeft - 5, labelY);
  ctx.textAlign = "center";
  for (const [hz, text] of frequencies) {
    ctx.fillText(text, frequencyX(layout, hz), labelY);
  }
};

export const createBarGradient = (ctx: SpectrumContext, layout: SpectrumLayout, palette: SpectrumPalette) => {
  const gradient = ctx.createLinearGradient(0, layout.plotBottom, 0, layout.plotTop);
  for (const step of palette.steps) gradient.addColorStop(levelToUnit(step.db), step.color);
  return gradient;
};

export interface FrameDrawOptions {
  layout: SpectrumLayout;
  palette: SpectrumPalette;
  tier: SpectrumTier;
  gradient: CanvasGradient | null;
  glow: boolean;
  ratio: number;
  meterLabels?: readonly string[];
}

/** Colour steps used by the lowest tier, which skips the gradient to save fill cost. */
const FLAT_STEPS_DB = [SPECTRUM_DISPLAY_MIN_DB, -48, -30, -16, -9, -4, SPECTRUM_DISPLAY_MAX_DB] as const;

const drawFlatBar = (
  ctx: SpectrumContext,
  options: FrameDrawOptions,
  x: number,
  width: number,
  levelDb: number,
): void => {
  const { layout, palette } = options;
  const top = levelY(layout, levelDb);
  for (let step = 0; step < FLAT_STEPS_DB.length - 1; step++) {
    const lower = levelY(layout, FLAT_STEPS_DB[step]);
    const upper = Math.max(top, levelY(layout, FLAT_STEPS_DB[step + 1]));
    if (lower <= top) break;
    ctx.fillStyle = colorAtLevel(palette.steps, FLAT_STEPS_DB[step]);
    ctx.fillRect(x, upper, width, lower - upper);
  }
};

/**
 * Draws the bars and peak caps for one frame over the static layer. Allocation-free: it reads the
 * ballistics arrays directly and creates no objects.
 */
export const drawBars = (ctx: SpectrumContext, options: FrameDrawOptions, state: SpectrumBallisticsState): void => {
  const { layout, palette, tier, gradient, glow, ratio } = options;
  const bars = state.levels.length;
  const pitch = (layout.plotRight - layout.plotLeft) / bars;
  const gap = bars <= 12 ? 3 : bars <= 24 ? 2 : 1;
  const plotHeight = layout.plotBottom - layout.plotTop;

  if (tier.gradient && gradient) ctx.fillStyle = gradient;
  if (glow) {
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < bars; i++) {
      const h = levelToUnit(state.levels[i]) * plotHeight;
      if (h < 2) continue;
      ctx.fillRect(layout.plotLeft + i * pitch - 1.5, layout.plotBottom - h - 3, pitch - gap + 3, h + 3);
    }
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < bars; i++) {
    const x = alignToDevicePixel(layout.plotLeft + i * pitch, ratio);
    const width = alignToDevicePixel(layout.plotLeft + (i + 1) * pitch, ratio) - x - gap;
    const h = levelToUnit(state.levels[i]) * plotHeight;
    if (h < 1) continue;
    if (tier.gradient && gradient) ctx.fillRect(x, layout.plotBottom - h, width, h);
    else drawFlatBar(ctx, options, x, width, state.levels[i]);
  }
  ctx.fillStyle = palette.cap;
  for (let i = 0; i < bars; i++) {
    const unit = levelToUnit(state.peaks[i]);
    if (unit < 0.02) continue;
    const x = alignToDevicePixel(layout.plotLeft + i * pitch, ratio);
    const width = alignToDevicePixel(layout.plotLeft + (i + 1) * pitch, ratio) - x - gap;
    const y = Math.max(layout.plotTop, layout.plotBottom - unit * plotHeight - CAP_HEIGHT_PX);
    ctx.fillRect(x, y, width, CAP_HEIGHT_PX);
  }
};

export const createMeterGradient = (ctx: SpectrumContext, layout: SpectrumLayout, palette: SpectrumPalette) => {
  const gradient = ctx.createLinearGradient(layout.plotLeft, 0, layout.plotRight, 0);
  for (const step of palette.steps) gradient.addColorStop(levelToUnit(step.db), step.color);
  return gradient;
};

export const drawMeters = (
  ctx: SpectrumContext,
  options: FrameDrawOptions,
  state: SpectrumBallisticsState,
  gradient: CanvasGradient | null,
  clipped: ArrayLike<boolean> = [],
): void => {
  const { layout, palette, ratio } = options;
  const labels = options.meterLabels;
  const count = labels?.length ?? 2;
  const span = layout.plotRight - layout.plotLeft;
  for (let channel = 0; channel < count; channel++) {
    const y = count === 1 ? 22 : 10 + channel * 24;
    const rmsIndex = channel * 2;
    const peakIndex = rmsIndex + 1;
    const rmsWidth = levelToUnit(state.levels[rmsIndex]) * span;
    const peakWidth = Math.max(rmsWidth, levelToUnit(state.levels[peakIndex]) * span);
    ctx.fillStyle = gradient ?? colorAtLevel(palette.steps, state.levels[peakIndex]);
    if (peakWidth - rmsWidth >= 1) {
      ctx.globalAlpha = 0.45;
      ctx.fillRect(layout.plotLeft + rmsWidth, y, peakWidth - rmsWidth, METER_HEIGHT_PX);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = gradient ?? colorAtLevel(palette.steps, state.levels[rmsIndex]);
    if (rmsWidth >= 1) ctx.fillRect(layout.plotLeft, y, rmsWidth, METER_HEIGHT_PX);
    if (clipped[channel]) {
      ctx.fillStyle = palette.steps[palette.steps.length - 1].color;
      ctx.fillRect(layout.plotRight - CLIP_BLOCK_PX, y, CLIP_BLOCK_PX, METER_HEIGHT_PX);
    }
    const heldPeak = levelToUnit(state.peaks[peakIndex]);
    if (heldPeak < 0.02) continue;
    ctx.fillStyle = palette.cap;
    const x = alignToDevicePixel(layout.plotLeft + heldPeak * span - CAP_HEIGHT_PX, ratio);
    ctx.fillRect(Math.max(layout.plotLeft, x), y - 2, CAP_HEIGHT_PX, METER_HEIGHT_PX + 4);
  }
};
