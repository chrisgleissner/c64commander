/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  countSonglengthsEntries,
  parseSonglengths,
  resolveSonglengthsDurationMs,
  resolveSonglengthsSeconds,
} from '@/lib/sid/songlengths';

vi.mock('@/lib/sid/sidUtils', () => ({
  computeSidMd5: async () => 'deadbeefdeadbeefdeadbeefdeadbeef',
}));

const fixture = `
; /HVSC/Demos/demo.sid
c0ffeec0ffeec0ffeec0ffeec0ffee00=0:30 0:40
; /HVSC/Demos/demo2.sid
c0c0anutc0c0anutc0c0anutc0c0anut=1:15
`;

describe('parseSonglengths', () => {
  it('maps path and md5 entries to seconds arrays', () => {
    const data = parseSonglengths(fixture);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo.sid')).toEqual([30, 40]);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo2.sid')).toEqual([75]);
    expect(data.md5ToSeconds.get('c0ffeec0ffeec0ffeec0ffeec0ffee00')).toEqual([30, 40]);
    expect(data.md5ToSeconds.get('c0c0anutc0c0anutc0c0anutc0c0anut')).toEqual([75]);
  });

  it('parses legacy songlengths.txt path entries', () => {
    const txtFixture = `
      /HVSC/Demos/demo.sid 0:25
      /HVSC/Demos/demo2.sid 1:05
    `;
    const data = parseSonglengths(txtFixture);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo.sid')).toEqual([25]);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo2.sid')).toEqual([65]);
    expect(data.md5ToSeconds.size).toBe(0);
  });

  it('parses old-format attribute tokens (G/M/Z/B)', () => {
    const data = parseSonglengths('aabbcc=0:06(G) 0:02(M)');
    expect(data.md5ToSeconds.get('aabbcc')).toEqual([6, 2]);
  });

  it('resolves seconds by path or md5 and songNr', () => {
    const data = parseSonglengths(fixture);
    expect(resolveSonglengthsSeconds(data, '/HVSC/Demos/demo.sid', null, 1)).toBe(30);
    expect(resolveSonglengthsSeconds(data, '/HVSC/Demos/demo.sid', null, 2)).toBe(40);
    expect(resolveSonglengthsSeconds(data, '/HVSC/Demos/demo.sid', null, 3)).toBeNull();
    expect(resolveSonglengthsSeconds(data, '/missing.sid', 'c0c0anutc0c0anutc0c0anutc0c0anut', 1)).toBe(75);
    expect(resolveSonglengthsSeconds(data, '/missing.sid', 'missing', 1)).toBeNull();
  });

  it('counts songlengths entries', () => {
    const data = parseSonglengths(fixture);
    expect(countSonglengthsEntries(data)).toBe(2);
  });

  it('resolves duration ms using path or md5 fallback', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const md5Fixture = 'deadbeefdeadbeefdeadbeefdeadbeef=0:42 0:55';
    const data = parseSonglengths(md5Fixture);
    const file = {
      name: 'demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => buffer,
    };

    const pathDuration = await resolveSonglengthsDurationMs(parseSonglengths(fixture), '/HVSC/Demos/demo.sid', file, 1);
    expect(pathDuration).toBe(30 * 1000);

    const pathDurationSong2 = await resolveSonglengthsDurationMs(parseSonglengths(fixture), '/HVSC/Demos/demo.sid', file, 2);
    expect(pathDurationSong2).toBe(40 * 1000);

    const md5Duration = await resolveSonglengthsDurationMs(data, '/missing.sid', file, 2);
    expect(md5Duration).toBe(55 * 1000);
  });

  it('resolves duration by path without file data', async () => {
    const data = parseSonglengths('/songs/demo.sid 0:25');
    const duration = await resolveSonglengthsDurationMs(data, '/songs/demo.sid', null, 1);
    expect(duration).toBe(25 * 1000);
  });

  it('returns null duration when data is null', async () => {
    expect(await resolveSonglengthsDurationMs(null, '/any.sid')).toBeNull();
  });

  it('returns null duration when data is undefined', async () => {
    expect(await resolveSonglengthsDurationMs(undefined, '/any.sid')).toBeNull();
  });

  it('returns 0 count for null or undefined data', () => {
    expect(countSonglengthsEntries(null)).toBe(0);
    expect(countSonglengthsEntries(undefined)).toBe(0);
  });

  it('returns null seconds for null data', () => {
    expect(resolveSonglengthsSeconds(null, '/any.sid')).toBeNull();
  });

  it('returns null when songNr exceeds available entries', () => {
    const data = parseSonglengths('; /demo.sid\nabc=0:30');
    expect(resolveSonglengthsSeconds(data, '/demo.sid', null, 5)).toBeNull();
  });

  it('defaults songNr 0 to first entry', () => {
    const data = parseSonglengths('; /demo.sid\nabc=0:30 0:45');
    expect(resolveSonglengthsSeconds(data, '/demo.sid', null, 0)).toBe(30);
  });

  it('handles backslash path normalization', () => {
    const data = parseSonglengths('; /HVSC\\Demos\\demo.sid\nabc=0:30');
    expect(resolveSonglengthsSeconds(data, '/HVSC/Demos/demo.sid', null, 1)).toBe(30);
  });

  it('handles paths without leading slash', () => {
    const data = parseSonglengths('; HVSC/Demos/demo.sid\nabc=0:30');
    expect(resolveSonglengthsSeconds(data, 'HVSC/Demos/demo.sid', null, 1)).toBe(30);
  });

  it('skips bracket lines in HVSC format', () => {
    const input = '; /demo.sid\n[Database]\nabc=0:30';
    const data = parseSonglengths(input);
    expect(data.pathToSeconds.get('/demo.sid')).toEqual([30]);
  });

  it('skips lines with hash comment prefix', () => {
    const input = '# comment line\n; /demo.sid\nabc=0:30';
    const data = parseSonglengths(input);
    expect(data.pathToSeconds.size).toBe(1);
  });

  it('skips lines with colon prefix and treats as path', () => {
    const input = ': /HVSC/Songs/tune.sid\nabc=1:00';
    const data = parseSonglengths(input);
    expect(data.pathToSeconds.get('/HVSC/Songs/tune.sid')).toEqual([60]);
  });

  it('handles sub-second durations with fractional parts', () => {
    const data = parseSonglengths('; /demo.sid\nabc=1:30.500');
    expect(resolveSonglengthsSeconds(data, '/demo.sid', null, 1)).toBe(91);
  });

  it('handles md5 lookup with whitespace padding', () => {
    const data = parseSonglengths('; /demo.sid\nabc=0:30');
    expect(resolveSonglengthsSeconds(data, '/nope.sid', '  ABC  ', 1)).toBe(30);
  });

  it('returns null when md5 fallback also misses', () => {
    const data = parseSonglengths('; /demo.sid\nabc=0:30');
    expect(resolveSonglengthsSeconds(data, '/nope.sid', 'missing_md5', 1)).toBeNull();
  });

  it('returns null when md5 is falsy', () => {
    const data = parseSonglengths('; /demo.sid\nabc=0:30');
    expect(resolveSonglengthsSeconds(data, '/nope.sid', null, 1)).toBeNull();
    expect(resolveSonglengthsSeconds(data, '/nope.sid', '', 1)).toBeNull();
  });

  it('handles md5 fallback in resolveSonglengthsDurationMs when computeSidMd5 returns known md5', async () => {
    const md5Fixture = 'deadbeefdeadbeefdeadbeefdeadbeef=0:42';
    const data = parseSonglengths(md5Fixture);
    const file = {
      name: 'test.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, '/unknown.sid', file, 1);
    expect(duration).toBe(42 * 1000);
  });

  it('returns null when computeSidMd5 md5 is also not found', async () => {
    const data = parseSonglengths('; /demo.sid\nabc=0:30');
    const file = {
      name: 'test.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
    const duration = await resolveSonglengthsDurationMs(data, '/unknown.sid', file, 1);
    expect(duration).toBeNull();
  });

  it('ignores empty md5 or value in equals-format lines', () => {
    const data = parseSonglengths('=0:30\nabc=');
    expect(data.md5ToSeconds.size).toBe(0);
    expect(data.pathToSeconds.size).toBe(0);
  });

  it('ignores durations with unparseable tokens', () => {
    const data = parseSonglengths('; /demo.sid\nabc=notaTime');
    expect(data.md5ToSeconds.get('abc')).toBeUndefined();
  });

  it('ignores legacy lines with only path and no duration', () => {
    const data = parseSonglengths('/just/path.sid');
    expect(data.pathToSeconds.size).toBe(0);
  });
});
