import { describe, expect, it, vi } from 'vitest';
import {
    createSliderAsyncQueue,
    resolveMidpointSnap,
    shouldTriggerMidpointHaptic,
} from './sliderBehavior';

describe('createSliderAsyncQueue', () => {
    it('coalesces changes and emits the latest value', async () => {
        vi.useFakeTimers();
        const changes: number[] = [];
        const queue = createSliderAsyncQueue({
            onChange: (value) => changes.push(value),
            throttleMs: 50,
        });

        queue.schedule(1);
        queue.schedule(2);
        queue.schedule(3);

        vi.advanceTimersByTime(49);
        expect(changes).toEqual([]);

        vi.advanceTimersByTime(1);
        await Promise.resolve();
        expect(changes).toEqual([3]);

        vi.useRealTimers();
    });

    it('commits immediately and clears pending changes', async () => {
        vi.useFakeTimers();
        const changes: number[] = [];
        const commits: number[] = [];
        const queue = createSliderAsyncQueue({
            onChange: (value) => changes.push(value),
            onCommit: (value) => commits.push(value),
            throttleMs: 100,
        });

        queue.schedule(4);
        queue.commit(7);

        await Promise.resolve();
        expect(commits).toEqual([7]);
        expect(changes).toEqual([]);

        vi.useRealTimers();
    });
});

describe('resolveMidpointSnap', () => {
    it('snaps within range and returns original outside', () => {
        expect(resolveMidpointSnap({ value: 50, min: 0, max: 100, midpoint: 50, snapRange: 2 })).toBe(50);
        expect(resolveMidpointSnap({ value: 51.5, min: 0, max: 100, midpoint: 50, snapRange: 2 })).toBe(50);
        expect(resolveMidpointSnap({ value: 60, min: 0, max: 100, midpoint: 50, snapRange: 2 })).toBe(60);
    });
});

describe('shouldTriggerMidpointHaptic', () => {
    it('triggers when crossing the midpoint', () => {
        const base = { midpoint: 5, nowMs: 1000, lastTriggerMs: null };
        expect(shouldTriggerMidpointHaptic({ ...base, previous: 2, next: 5 })).toBe(true);
        expect(shouldTriggerMidpointHaptic({ ...base, previous: 6, next: 5 })).toBe(true);
        expect(shouldTriggerMidpointHaptic({ ...base, previous: 1, next: 2 })).toBe(false);
    });
});
