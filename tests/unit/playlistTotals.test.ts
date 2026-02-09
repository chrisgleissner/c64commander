/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { calculatePlaylistTotals } from '@/lib/playback/playlistTotals';

describe('calculatePlaylistTotals', () => {
  it('returns dash when durations unknown', () => {
    const totals = calculatePlaylistTotals([5000, undefined], 0);
    expect(totals.total).toBeUndefined();
    expect(totals.remaining).toBeUndefined();
  });

  it('computes total and remaining based on played time', () => {
    const totals = calculatePlaylistTotals([5000, 7000, 4000], 3000);
    expect(totals.total).toBe(16000);
    expect(totals.remaining).toBe(13000);
  });

  it('uses total as remaining when played is zero', () => {
    const totals = calculatePlaylistTotals([1000, 2000], 0);
    expect(totals.total).toBe(3000);
    expect(totals.remaining).toBe(3000);
  });

  it('clamps remaining at zero when played exceeds total', () => {
    const totals = calculatePlaylistTotals([1000, 2000], 5000);
    expect(totals.total).toBe(3000);
    expect(totals.remaining).toBe(0);
  });
});
