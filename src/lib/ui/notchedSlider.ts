/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export interface Notch {
  id: string;
  label: string;
  value: number;
}

/** A value this close to a notch, as a share of the whole range, is pulled onto it. */
export const NOTCH_SNAP_RATIO = 0.06;
/** Holding Left or Right moves by this much per repeat, between and beyond the notches. */
export const NOTCH_REPEAT_STEP = 5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The value with magnetic snapping applied, and the notch it snapped to, if any. */
export const snapToNotch = (
  value: number,
  notches: readonly Notch[],
  min: number,
  max: number,
): { value: number; notch: Notch | null } => {
  const reach = (max - min) * NOTCH_SNAP_RATIO;
  const rounded = Math.round(clamp(value, min, max));
  let best: Notch | null = null;
  for (const notch of notches) {
    const distance = Math.abs(notch.value - value);
    if (distance <= reach && (!best || distance < Math.abs(best.value - value))) best = notch;
  }
  return best ? { value: best.value, notch: best } : { value: rounded, notch: null };
};

/** The next notch beyond `value` in `direction`, or `value` itself when there is none. */
export const stepNotch = (value: number, notches: readonly Notch[], direction: 1 | -1): number => {
  const sorted = [...notches].sort((a, b) => a.value - b.value);
  const next =
    direction > 0 ? sorted.find((notch) => notch.value > value) : [...sorted].reverse().find((n) => n.value < value);
  return next ? next.value : value;
};

export const repeatStep = (value: number, direction: 1 | -1, min: number, max: number): number =>
  clamp(value + direction * NOTCH_REPEAT_STEP, min, max);

export const nearestNotch = (value: number, notches: readonly Notch[]): Notch =>
  notches.reduce((best, notch) => (Math.abs(notch.value - value) < Math.abs(best.value - value) ? notch : best));

/** "Subtle, 35": the nearest notch's name and the exact amount; plain "Off" at zero. */
export const notchValueText = (value: number, notches: readonly Notch[]): string => {
  const notch = nearestNotch(value, notches);
  return value === 0 && notch.value === 0 ? notch.label : `${notch.label}, ${value}`;
};

/** The track value under a pointer, for a thumb of radius `inset` that stays inside the track. */
export const valueAtPosition = (offsetX: number, width: number, inset: number, min: number, max: number): number => {
  const usable = width - 2 * inset;
  if (usable <= 0) return min;
  return clamp(min + ((offsetX - inset) / usable) * (max - min), min, max);
};

/** CSS `left` of a value on a track whose thumb of radius `inset` px stays inside it. */
export const positionCss = (value: number, min: number, max: number, inset: number): string => {
  const share = max > min ? (clamp(value, min, max) - min) / (max - min) : 0;
  return `calc(${inset}px + (100% - ${2 * inset}px) * ${share.toFixed(4)})`;
};
