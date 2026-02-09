/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  releaseSingleFlight,
  resolvePlayTargetIndex,
  resolveVolumeSyncDecision,
  tryAcquireSingleFlight,
  type BooleanRef,
} from '@/pages/playFiles/playbackGuards';

describe('playbackGuards', () => {
  it('starts from first item when playlist has items and no prior playback', () => {
    expect(resolvePlayTargetIndex(3, -1)).toBe(0);
  });

  it('uses current index when playback already has a selected item', () => {
    expect(resolvePlayTargetIndex(3, 2)).toBe(2);
  });

  it('prevents duplicate single-flight start requests during rapid taps', () => {
    const lock: BooleanRef = { current: false };
    expect(tryAcquireSingleFlight(lock)).toBe(true);
    expect(tryAcquireSingleFlight(lock)).toBe(false);
    releaseSingleFlight(lock);
    expect(tryAcquireSingleFlight(lock)).toBe(true);
  });

  it('defers volume sync while UI target is still in its hold window', () => {
    const now = 10_000;
    expect(resolveVolumeSyncDecision({ index: 7, setAtMs: now - 200 }, 3, now, 2500)).toBe('defer');
  });

  it('clears pending volume target once backend matches or hold window expires', () => {
    const now = 10_000;
    expect(resolveVolumeSyncDecision({ index: 5, setAtMs: now - 50 }, 5, now, 2500)).toBe('clear');
    expect(resolveVolumeSyncDecision({ index: 5, setAtMs: now - 4000 }, 3, now, 2500)).toBe('clear');
  });
});
