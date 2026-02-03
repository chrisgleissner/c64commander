import { describe, expect, it } from 'vitest';
import { parseSonglengths, resolveSonglengthsDurationMs } from '@/lib/sid/songlengths';
import { computeSidMd5 } from '@/lib/sid/sidUtils';

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
    const md5 = await computeSidMd5(buffer);
    const data = parseSonglengths(`${md5}=0:42 0:55`);
    const file = {
      name: 'demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, '/missing.sid', file, 2);
    expect(duration).toBe(55 * 1000);
  });
});
