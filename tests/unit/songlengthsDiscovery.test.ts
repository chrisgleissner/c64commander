import { describe, expect, it } from 'vitest';
import { isSonglengthsFileName } from '@/lib/sid/songlengthsDiscovery';

describe('songlengths discovery helpers', () => {
  it('accepts .txt and .md5 case-insensitively', () => {
    expect(isSonglengthsFileName('songlengths.txt')).toBe(true);
    expect(isSonglengthsFileName('SONGLENGTHS.TXT')).toBe(true);
    expect(isSonglengthsFileName('songlengths.md5')).toBe(true);
    expect(isSonglengthsFileName('Songlengths.MD5')).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(isSonglengthsFileName('songlengths.sid')).toBe(false);
    expect(isSonglengthsFileName('notes.md')).toBe(false);
  });
});
