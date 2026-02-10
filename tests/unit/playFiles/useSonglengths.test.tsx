/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { parseSonglengths, resolveSonglengthsDurationMs } from '@/lib/sid/songlengths';

vi.mock('@/lib/sid/sidUtils', () => ({
  computeSidMd5: async () => 'deadbeefdeadbeefdeadbeefdeadbeef',
}));

describe('songlengths helpers', () => {
  it('resolves duration by path when available', async () => {
    const data = parseSonglengths('/songs/demo.sid 0:25');
    const file = {
      name: 'demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, '/songs/demo.sid', file, 1);
    expect(duration).toBe(25 * 1000);
  });

  it('resolves duration by md5 fallback when path is missing', async () => {
    const buffer = new Uint8Array([5, 6, 7, 8]).buffer;
    const data = parseSonglengths('deadbeefdeadbeefdeadbeefdeadbeef=0:42 0:55');
    const file = {
      name: 'demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, '/missing.sid', file, 2);
    expect(duration).toBe(55 * 1000);
  });
});
