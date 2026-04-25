import { describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_LAUNCH_SEQUENCE_TIMINGS,
    getLaunchSequenceTotalMs,
    runLaunchSequence,
} from '@/lib/startup/launchSequence';

describe('launchSequence', () => {
    it('emits the cold-start launch phases in order with the expected timings', () => {
        vi.useFakeTimers();

        const phases: string[] = [];
        runLaunchSequence({
            onPhaseChange: (phase) => {
                phases.push(phase);
            },
            schedule: (callback, delayMs) => setTimeout(callback, delayMs),
            cancel: (handle) => clearTimeout(handle),
        });

        expect(phases).toEqual(['fade-in']);

        vi.advanceTimersByTime(DEFAULT_LAUNCH_SEQUENCE_TIMINGS.fadeInMs);
        expect(phases).toEqual(['fade-in', 'hold']);

        vi.advanceTimersByTime(DEFAULT_LAUNCH_SEQUENCE_TIMINGS.holdMs);
        expect(phases).toEqual(['fade-in', 'hold', 'fade-out']);

        vi.advanceTimersByTime(DEFAULT_LAUNCH_SEQUENCE_TIMINGS.fadeOutMs);
        expect(phases).toEqual(['fade-in', 'hold', 'fade-out', 'app-ready']);

        vi.useRealTimers();
    });

    it('cancels pending phase transitions when the launch sequence is torn down', () => {
        vi.useFakeTimers();

        const phases: string[] = [];
        const stop = runLaunchSequence({
            onPhaseChange: (phase) => {
                phases.push(phase);
            },
            schedule: (callback, delayMs) => setTimeout(callback, delayMs),
            cancel: (handle) => clearTimeout(handle),
        });

        stop();
        vi.advanceTimersByTime(getLaunchSequenceTotalMs());

        expect(phases).toEqual(['fade-in']);

        vi.useRealTimers();
    });
});
