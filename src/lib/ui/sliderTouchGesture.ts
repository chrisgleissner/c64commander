/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How far a touch must travel before a slider decides whether it is a slide or a page scroll.
 *
 * Radix moves the value on pointerdown, before the browser has seen enough movement to recognise a
 * vertical pan, so a scroll that started on a slider changed the value and wrote it to the device.
 * A touch therefore leaves the value alone until it has moved this far along one axis.
 */
export const SLIDER_TOUCH_SLOP_PX = 8;

export type SliderTouchIntent = "undecided" | "slide" | "scroll";

export const classifySliderTouch = (dx: number, dy: number, slopPx = SLIDER_TOUCH_SLOP_PX): SliderTouchIntent => {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < slopPx && absY < slopPx) return "undecided";
  return absX > absY ? "slide" : "scroll";
};

/** The value under `clientX` on a horizontal left-to-right track, snapped to `step` and clamped. */
export const sliderValueAtX = (
  clientX: number,
  track: { left: number; width: number },
  min: number,
  max: number,
  step: number | undefined,
): number => {
  if (track.width <= 0) return min;
  const fraction = Math.min(1, Math.max(0, (clientX - track.left) / track.width));
  const raw = min + fraction * (max - min);
  if (!step || !Number.isFinite(step) || step <= 0) return raw;
  const decimals = (String(step).split(".")[1] ?? "").length;
  const snapped = Number((Math.round((raw - min) / step) * step + min).toFixed(decimals));
  return Math.min(max, Math.max(min, snapped));
};
