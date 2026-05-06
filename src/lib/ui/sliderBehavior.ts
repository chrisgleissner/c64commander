/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const DEFAULT_MIDPOINT_SNAP_RATIO = 0.02;
export const DEFAULT_MIDPOINT_HAPTIC_INTERVAL_MS = 200;

export const clampSliderValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const resolveMidpointSnap = (params: {
  value: number;
  min: number;
  max: number;
  midpoint: number;
  snapRange?: number;
  step?: number;
}) => {
  const range = Math.max(0, params.max - params.min);
  if (!Number.isFinite(range) || range <= 0) return params.value;
  const stepRange = params.step !== undefined ? Math.abs(params.step) * 0.75 : undefined;
  const defaultRange = range * DEFAULT_MIDPOINT_SNAP_RATIO;
  const snapRange =
    params.snapRange !== undefined ? Math.max(0, params.snapRange) : Math.max(stepRange ?? 0, defaultRange);
  if (snapRange <= 0) return params.value;
  return Math.abs(params.value - params.midpoint) <= snapRange ? params.midpoint : params.value;
};

export const resolveMidpointPercent = (midpoint: number, min: number, max: number) => {
  const range = max - min;
  if (!Number.isFinite(range) || range === 0) return 0;
  return Math.max(0, Math.min(100, ((midpoint - min) / range) * 100));
};

export const shouldTriggerMidpointHaptic = (params: {
  previous: number | null;
  next: number;
  midpoint: number;
  nowMs: number;
  lastTriggerMs: number | null;
  minIntervalMs?: number;
}) => {
  const { previous, next, midpoint, nowMs, lastTriggerMs, minIntervalMs } = params;
  const interval = minIntervalMs ?? DEFAULT_MIDPOINT_HAPTIC_INTERVAL_MS;
  if (lastTriggerMs !== null && nowMs - lastTriggerMs < interval) return false;
  if (previous === null) return next === midpoint;
  const crossed = (previous < midpoint && next >= midpoint) || (previous > midpoint && next <= midpoint);
  const snapped = next === midpoint && previous !== midpoint;
  return crossed || snapped;
};
