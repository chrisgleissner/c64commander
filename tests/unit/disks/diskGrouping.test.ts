import { describe, expect, it } from 'vitest';
import { assignDiskGroupsByPrefix } from '@/lib/disks/diskGrouping';

describe('assignDiskGroupsByPrefix', () => {
  it('groups numeric suffixes in the same folder', () => {
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/foo1.d64', name: 'foo1.d64' },
      { path: '/Games/foo2.d64', name: 'foo2.d64' },
      { path: '/Games/foo3.d64', name: 'foo3.d64' },
    ]);
    expect(result.get('/Games/foo1.d64')).toBe('foo');
    expect(result.get('/Games/foo2.d64')).toBe('foo');
    expect(result.get('/Games/foo3.d64')).toBe('foo');
  });

  it('groups hyphenated disk numbers', () => {
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/Last Ninja 3-1.d64', name: 'Last Ninja 3-1.d64' },
      { path: '/Games/Last Ninja 3-2.d64', name: 'Last Ninja 3-2.d64' },
    ]);
    expect(result.get('/Games/Last Ninja 3-1.d64')).toBe('Last Ninja 3');
    expect(result.get('/Games/Last Ninja 3-2.d64')).toBe('Last Ninja 3');
  });

  it('groups single-letter suffixes', () => {
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/DiskA.d64', name: 'DiskA.d64' },
      { path: '/Games/DiskB.d64', name: 'DiskB.d64' },
    ]);
    expect(result.get('/Games/DiskA.d64')).toBe('Disk');
    expect(result.get('/Games/DiskB.d64')).toBe('Disk');
  });

  it('does not group across folders', () => {
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/foo1.d64', name: 'foo1.d64' },
      { path: '/Other/foo2.d64', name: 'foo2.d64' },
    ]);
    expect(result.get('/Games/foo1.d64')).toBeUndefined();
    expect(result.get('/Other/foo2.d64')).toBeUndefined();
  });
});
