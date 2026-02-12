/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSslPayload, getSidSongCount } from '@/lib/sid/sidUtils';

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

  it('encodes zero duration as 00:00', () => {
    expect(Array.from(createSslPayload(0))).toEqual([0x00, 0x00]);
  });

  it('encodes maximum supported duration 99:59', () => {
    expect(Array.from(createSslPayload((99 * 60 * 1000) + (59 * 1000)))).toEqual([0x99, 0x59]);
  });

  it('throws for negative duration', () => {
    expect(() => createSslPayload(-1)).toThrow('non-negative');
  });

  it('throws for non-finite duration', () => {
    expect(() => createSslPayload(Number.NaN)).toThrow('finite');
    expect(() => createSslPayload(Number.POSITIVE_INFINITY)).toThrow('finite');
  });

  it('throws for values exceeding 99:59', () => {
    expect(() => createSslPayload((100 * 60 * 1000))).toThrow('99:59');
  });
});
