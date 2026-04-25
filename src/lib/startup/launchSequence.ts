/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type LaunchSequencePhase = 'fade-in' | 'hold' | 'fade-out' | 'app-ready';

export type LaunchSequenceTimings = {
    fadeInMs: number;
    holdMs: number;
    fadeOutMs: number;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type LaunchSequenceScheduler = (callback: () => void, delayMs: number) => TimerHandle;
type LaunchSequenceCanceller = (handle: TimerHandle) => void;

export const DEFAULT_LAUNCH_SEQUENCE_TIMINGS: LaunchSequenceTimings = {
    fadeInMs: 300,
    holdMs: 1700,
    fadeOutMs: 250,
};

const normalizeDelay = (value: number, label: string) => {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a finite non-negative number`);
    }
    return Math.round(value);
};

export const normalizeLaunchSequenceTimings = (
    timings: Partial<LaunchSequenceTimings> | undefined,
): LaunchSequenceTimings => {
    const merged = {
        ...DEFAULT_LAUNCH_SEQUENCE_TIMINGS,
        ...timings,
    };

    return {
        fadeInMs: normalizeDelay(merged.fadeInMs, 'fadeInMs'),
        holdMs: normalizeDelay(merged.holdMs, 'holdMs'),
        fadeOutMs: normalizeDelay(merged.fadeOutMs, 'fadeOutMs'),
    };
};

export const getLaunchSequenceTotalMs = (timings?: Partial<LaunchSequenceTimings>) => {
    const resolved = normalizeLaunchSequenceTimings(timings);
    return resolved.fadeInMs + resolved.holdMs + resolved.fadeOutMs;
};

export const runLaunchSequence = ({
    onPhaseChange,
    timings,
    schedule = (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel = (handle) => window.clearTimeout(handle),
}: {
    onPhaseChange: (phase: LaunchSequencePhase) => void;
    timings?: Partial<LaunchSequenceTimings>;
    schedule?: LaunchSequenceScheduler;
    cancel?: LaunchSequenceCanceller;
}) => {
    const resolvedTimings = normalizeLaunchSequenceTimings(timings);
    const handles: TimerHandle[] = [];

    onPhaseChange('fade-in');
    handles.push(schedule(() => onPhaseChange('hold'), resolvedTimings.fadeInMs));
    handles.push(schedule(() => onPhaseChange('fade-out'), resolvedTimings.fadeInMs + resolvedTimings.holdMs));
    handles.push(
        schedule(
            () => onPhaseChange('app-ready'),
            resolvedTimings.fadeInMs + resolvedTimings.holdMs + resolvedTimings.fadeOutMs,
        ),
    );

    return () => {
        for (const handle of handles) {
            cancel(handle);
        }
    };
};
