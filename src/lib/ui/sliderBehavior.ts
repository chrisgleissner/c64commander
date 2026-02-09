/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const DEFAULT_SLIDER_ASYNC_THROTTLE_MS = 120;
export const DEFAULT_MIDPOINT_SNAP_RATIO = 0.02;
export const DEFAULT_MIDPOINT_HAPTIC_INTERVAL_MS = 200;

export type SliderAsyncQueue = {
    schedule: (value: number) => void;
    commit: (value: number) => void;
    cancel: () => void;
};

export const clampSliderValue = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

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
    const snapRange = params.snapRange !== undefined
        ? Math.max(0, params.snapRange)
        : Math.max(stepRange ?? 0, defaultRange);
    if (snapRange <= 0) return params.value;
    return Math.abs(params.value - params.midpoint) <= snapRange
        ? params.midpoint
        : params.value;
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

export const createSliderAsyncQueue = (params: {
    onChange?: (value: number) => void;
    onCommit?: (value: number) => void;
    throttleMs?: number;
}): SliderAsyncQueue => {
    const { onChange, onCommit, throttleMs } = params;
    const delay = throttleMs ?? DEFAULT_SLIDER_ASYNC_THROTTLE_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: number | null = null;

    const flush = () => {
        if (pendingValue === null || !onChange) {
            pendingValue = null;
            timer = null;
            return;
        }
        const value = pendingValue;
        pendingValue = null;
        timer = null;
        queueMicrotask(() => {
            onChange(value);
        });
    };

    return {
        schedule: (value: number) => {
            if (!onChange) return;
            pendingValue = value;
            if (timer !== null) return;
            timer = setTimeout(flush, delay);
        },
        commit: (value: number) => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            pendingValue = null;
            const handler = onCommit ?? onChange;
            if (!handler) return;
            queueMicrotask(() => {
                handler(value);
            });
        },
        cancel: () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            pendingValue = null;
        },
    };
};
