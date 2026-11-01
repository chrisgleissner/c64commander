/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { SpectrumPalette } from "@/lib/audio/spectrum/spectrumColors";
import type { FrameDrawOptions, SpectrumContext, SpectrumLayout } from "@/lib/audio/spectrum/spectrumRenderer";

export const WAVE_POINTS = 256;
const BYTE_FULL_SCALE = 127;
const UNTRIGGERED_ALPHA = 0.45;

const plotCentre = (layout: SpectrumLayout): number => (layout.plotTop + layout.plotBottom) / 2;

/** Fills [out] from a base64 `Int8Array` of [WAVE_POINTS] points. Throws, leaving [out] as it was, when it is not one. */
export const decodeWave = (encoded: string, out: Int8Array): void => {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch (error) {
    throw new Error(`The spectrum wave is not valid base64 (${encoded.length} characters)`, { cause: error });
  }
  if (binary.length !== WAVE_POINTS) {
    throw new Error(`The spectrum wave has ${binary.length} points, expected ${WAVE_POINTS}`);
  }
  for (let i = 0; i < WAVE_POINTS; i++) out[i] = (binary.charCodeAt(i) << 24) >> 24;
};

/** The waveform last received, kept so that a frame without one leaves the picture as it was. */
export class WaveTrace {
  readonly points = new Int8Array(WAVE_POINTS);
  triggered = false;
  private warned = false;

  update(frame: { wave?: string; waveTriggered?: boolean }): void {
    if (typeof frame.wave !== "string") return;
    try {
      decodeWave(frame.wave, this.points);
    } catch (error) {
      if (this.warned) return;
      this.warned = true;
      addLog("warn", "Spectrum: the plugin returned a wave that cannot be drawn", {
        service: "audio-fx",
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      return;
    }
    this.triggered = frame.waveTriggered === true;
  }

  clear(): void {
    this.points.fill(0);
    this.triggered = false;
  }
}

/** The part of the picture that does not move: a faint line through the middle of the plot. */
export const drawWaveBackdrop = (ctx: SpectrumContext, layout: SpectrumLayout, palette: SpectrumPalette): void => {
  const y = plotCentre(layout);
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.grid;
  ctx.beginPath();
  ctx.moveTo(layout.plotLeft, y);
  ctx.lineTo(layout.plotRight, y);
  ctx.stroke();
};

/** One polyline across the plot, from the top at +127 to the bottom at -127. Dimmer while the window is not triggered. */
export const drawWave = (ctx: SpectrumContext, options: FrameDrawOptions, trace: WaveTrace): void => {
  const { layout, palette } = options;
  const centre = plotCentre(layout);
  const halfHeight = (layout.plotBottom - layout.plotTop) / 2;
  const span = layout.plotRight - layout.plotLeft;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = palette.cap;
  ctx.globalAlpha = trace.triggered ? 1 : UNTRIGGERED_ALPHA;
  ctx.beginPath();
  for (let i = 0; i < WAVE_POINTS; i++) {
    const level = Math.max(-BYTE_FULL_SCALE, trace.points[i]) / BYTE_FULL_SCALE;
    const x = layout.plotLeft + (i / (WAVE_POINTS - 1)) * span;
    const y = centre - level * halfHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
};
