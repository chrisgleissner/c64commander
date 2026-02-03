import { describe, expect, it } from 'vitest';
import {
  countSonglengthsEntries,
  parseSonglengths,
  resolveSonglengthsDurationMs,
  resolveSonglengthsSeconds,
} from '@/lib/sid/songlengths';
import { computeSidMd5 } from '@/lib/sid/sidUtils';

const fixture = `
; /HVSC/Demos/demo.sid
c0ffeec0ffeec0ffeec0ffeec0ffee00=0:30
; /HVSC/Demos/demo2.sid
c0c0anutc0c0anutc0c0anutc0c0anut=1:15
`;

describe('parseSonglengths', () => {
  it('maps path and md5 entries to seconds', () => {
    const data = parseSonglengths(fixture);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo.sid')).toBe(30);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo2.sid')).toBe(75);
    expect(data.md5ToSeconds.get('c0ffeec0ffeec0ffeec0ffeec0ffee00')).toBe(30);
    expect(data.md5ToSeconds.get('c0c0anutc0c0anutc0c0anutc0c0anut')).toBe(75);
  });

  it('parses legacy songlengths.txt path entries', () => {
    const txtFixture = `
      /HVSC/Demos/demo.sid 0:25
      /HVSC/Demos/demo2.sid 1:05
    `;
    const data = parseSonglengths(txtFixture);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo.sid')).toBe(25);
    expect(data.pathToSeconds.get('/HVSC/Demos/demo2.sid')).toBe(65);
    expect(data.md5ToSeconds.size).toBe(0);
  });

  it('resolves seconds by path or md5', () => {
    const data = parseSonglengths(fixture);
    expect(resolveSonglengthsSeconds(data, '/HVSC/Demos/demo.sid')).toBe(30);
    expect(resolveSonglengthsSeconds(data, '/missing.sid', 'c0c0anutc0c0anutc0c0anutc0c0anut')).toBe(75);
    expect(resolveSonglengthsSeconds(data, '/missing.sid', 'missing')).toBeNull();
  });

  it('counts songlengths entries', () => {
    const data = parseSonglengths(fixture);
    expect(countSonglengthsEntries(data)).toBe(2);
  });

  it('resolves duration ms using path or md5 fallback', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const md5 = await computeSidMd5(buffer);
    const md5Fixture = `${md5}=0:42`;
    const data = parseSonglengths(md5Fixture);
    const file = {
      name: 'demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => buffer,
    };

    const pathDuration = await resolveSonglengthsDurationMs(parseSonglengths(fixture), '/HVSC/Demos/demo.sid', file);
    expect(pathDuration).toBe(30 * 1000);

    const md5Duration = await resolveSonglengthsDurationMs(data, '/missing.sid', file);
    expect(md5Duration).toBe(42 * 1000);
  });

  it('resolves duration by path without file data', async () => {
    const data = parseSonglengths('/songs/demo.sid 0:25');
    const duration = await resolveSonglengthsDurationMs(data, '/songs/demo.sid', null);
    expect(duration).toBe(25 * 1000);
  });
});
