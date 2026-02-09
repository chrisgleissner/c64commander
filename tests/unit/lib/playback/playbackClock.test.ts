/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlaybackClock } from '@/lib/playback/playbackClock';

describe('PlaybackClock', () => {
    let clock: PlaybackClock;

    beforeEach(() => {
        clock = new PlaybackClock();
    });

    it('starts at zero', () => {
        expect(clock.current(1000)).toBe(0);
    });

    it('tracks time after start', () => {
        const start = 1000;
        clock.start(start);
        expect(clock.current(start + 500)).toBe(500);
        expect(clock.current(start + 1500)).toBe(1500);
    });

    it('resets baseMs on restart if requested', () => {
        clock.start(1000);
        clock.pause(2000); // baseMs = 1000
        
        // Start without reset implies continue? 
        // Logic: start(now, reset=false). this.startedAt = now.
        // It keeps baseMs.
        
        clock.start(3000, false);
        expect(clock.current(3500)).toBe(1000 + 500); // 1500
        
        // Start with reset
        clock.start(4000, true);
        expect(clock.current(4500)).toBe(500);
    });

    it('pauses correctly', () => {
        clock.start(1000); // startedAt = 1000
        clock.pause(1500); // baseMs += 500 => 500. startedAt = null
        
        expect(clock.current(2000)).toBe(500); // Stopped, returns baseMs
        
        // Pause again should do nothing
        clock.pause(3000);
        expect(clock.current(3000)).toBe(500);
    });

    it('resumes correctly', () => {
        clock.start(1000);
        clock.pause(1500); // baseMs = 500
        
        expect(clock.current(2000)).toBe(500);
        
        clock.resume(2000); // startedAt = 2000
        expect(clock.current(2100)).toBe(500 + 100); // 600
        
        // Resume while running should do nothing
        clock.resume(3000); 
        expect(clock.current(3000)).toBe(600 + (3000 - 2100)); // 1500
    });

    it('stops correctly', () => {
        clock.start(1000);
        clock.stop(1500); // calls pause(1500) -> baseMs = 500
        expect(clock.current(2000)).toBe(500);
        
        clock.start(2000); // resume
        clock.stop(2500, true); // pause(2500) -> baseMs += 500 -> 1000. Then reset=true -> baseMs=0.
        expect(clock.current(3000)).toBe(0);
    });

    it('resets manually', () => {
        clock.start(1000);
        clock.reset();
        expect(clock.current(2000)).toBe(0);
    });

    it('hydrates state', () => {
        clock.hydrate(5000, null);
        expect(clock.current(1000)).toBe(5000);
        
        clock.hydrate(1000, 2000); // base=1000, start=2000
        expect(clock.current(2500)).toBe(1000 + 500); // 1500
    });
    
    it('handles negative time deltas gracefully', () => {
        // e.g. system time skew
        clock.start(5000);
        // current queried with time before start
        expect(clock.current(4000)).toBe(0); // Math.max(0, -1000)
        
        clock.pause(4000); // pause with time before start
        expect(clock.current(6000)).toBe(0);
        
        clock.hydrate(-500, null);
        expect(clock.current(0)).toBe(0); // Math.max(0, baseMs)
    });
});
