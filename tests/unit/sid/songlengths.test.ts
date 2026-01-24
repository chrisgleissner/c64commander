import { describe, expect, it } from 'vitest';
import { parseSonglengths } from '@/lib/sid/songlengths';

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
});
