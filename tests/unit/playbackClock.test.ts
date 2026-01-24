import { describe, expect, it } from 'vitest';
import { PlaybackClock } from '@/lib/playback/playbackClock';

describe('PlaybackClock', () => {
  it('accumulates played time across pause/resume', () => {
    const clock = new PlaybackClock();
    clock.start(0);
    expect(clock.current(0)).toBe(0);
    expect(clock.current(3000)).toBe(3000);

    clock.pause(3000);
    expect(clock.current(5000)).toBe(3000);

    clock.resume(5000);
    expect(clock.current(8000)).toBe(6000);
  });

  it('accumulates played time across skips without resetting', () => {
    const clock = new PlaybackClock();
    clock.start(0);
    clock.pause(2500);
    expect(clock.current(3000)).toBe(2500);

    clock.start(3000);
    expect(clock.current(4000)).toBe(3500);
  });

  it('resets when requested', () => {
    const clock = new PlaybackClock();
    clock.start(0);
    clock.pause(2000);
    expect(clock.current(2000)).toBe(2000);

    clock.stop(2000, true);
    expect(clock.current(4000)).toBe(0);
  });

  it('start with reset clears prior base', () => {
    const clock = new PlaybackClock();
    clock.start(0);
    clock.pause(2000);
    expect(clock.current(3000)).toBe(2000);

    clock.start(3000, true);
    expect(clock.current(4000)).toBe(1000);
  });
});
