/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { getSidSongCount } from '@/lib/sid/sidUtils';

describe('sidUtils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs when SID song count parsing fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    class ThrowingDataView {
      constructor() {
        throw new Error('boom');
      }
    }
    vi.stubGlobal('DataView', ThrowingDataView as unknown as typeof DataView);

    expect(getSidSongCount(new ArrayBuffer(4))).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to read SID song count',
      expect.objectContaining({
        byteLength: 4,
      }),
    );
  });
});
