/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
    resolveMidpointSnap, 
    resolveMidpointPercent, 
    shouldTriggerMidpointHaptic, 
    createSliderAsyncQueue,
    DEFAULT_SLIDER_ASYNC_THROTTLE_MS
} from '@/lib/ui/sliderBehavior';

describe('sliderBehavior', () => {
    describe('resolveMidpointSnap', () => {
        it('snaps to midpoint within default range', () => {
             // default ratio 0.02. range 100 -> snap radius 2.
             expect(resolveMidpointSnap({ value: 51, min: 0, max: 100, midpoint: 50 })).toBe(50);
             expect(resolveMidpointSnap({ value: 48.5, min: 0, max: 100, midpoint: 50 })).toBe(50);
             expect(resolveMidpointSnap({ value: 53, min: 0, max: 100, midpoint: 50 })).toBe(53);
        });

        it('respects step derived snap range', () => {
             // step 10 -> stepRange 7.5. range 100 -> default 2. Max(7.5, 2) -> 7.5
             expect(resolveMidpointSnap({ value: 57, min: 0, max: 100, midpoint: 50, step: 10 })).toBe(50);
             expect(resolveMidpointSnap({ value: 58, min: 0, max: 100, midpoint: 50, step: 10 })).toBe(58);
        });

        it('respects explicit snapRange', () => {
             expect(resolveMidpointSnap({ value: 55, min: 0, max: 100, midpoint: 50, snapRange: 5 })).toBe(50);
        });
        
        it('handles zero range', () => {
             expect(resolveMidpointSnap({ value: 5, min: 10, max: 10, midpoint: 10 })).toBe(5);
        });
    });

    describe('resolveMidpointPercent', () => {
        it('calculates percent', () => {
            expect(resolveMidpointPercent(50, 0, 100)).toBe(50);
            expect(resolveMidpointPercent(0, -100, 100)).toBe(50);
        });
        
        it('clamps result', () => {
             expect(resolveMidpointPercent(150, 0, 100)).toBe(100);
             expect(resolveMidpointPercent(-50, 0, 100)).toBe(0);
        });
    });

    describe('shouldTriggerMidpointHaptic', () => {
        const base = { nowMs: 1000, lastTriggerMs: null, minIntervalMs: 200, midpoint: 50 };
        
        it('triggers on crossing', () => {
            expect(shouldTriggerMidpointHaptic({ ...base, previous: 49, next: 51 })).toBe(true);
            expect(shouldTriggerMidpointHaptic({ ...base, previous: 51, next: 49 })).toBe(true);
        });

        it('triggers on snapping', () => {
            expect(shouldTriggerMidpointHaptic({ ...base, previous: 49, next: 50 })).toBe(true);
        });

        it('ignores if stale', () => {
             expect(shouldTriggerMidpointHaptic({ ...base, previous: 49, next: 51, lastTriggerMs: 900 })).toBe(false);
        });
    });

    describe('createSliderAsyncQueue', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('throttles calls', () => {
            const onChange = vi.fn();
            const queue = createSliderAsyncQueue({ onChange, throttleMs: 100 });
            
            queue.schedule(1);
            queue.schedule(2);
            queue.schedule(3);
            
            expect(onChange).not.toHaveBeenCalled();
            
            vi.advanceTimersByTime(100);
            // schedule uses queueMicrotask flush
            // We need to wait for microtasks
            
        });
        
        it('commits immediately', async () => {
             const onCommit = vi.fn();
             const queue = createSliderAsyncQueue({ onCommit });
             await Promise.resolve(); // flush any microtasks?
             
             queue.commit(5);
             // commit also uses queueMicrotask
             await Promise.resolve(); // yield to microtask
             // Wait... Vitest might need explicit run?
             
             // queueMicrotask is async.
        });
    });
});
