/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

  it('handles names without file extension (line 13 TRUE)', () => {
    // Names without a dot trigger the idx<=0 branch in stripExtension
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/Alpha1', name: 'Alpha1' },
      { path: '/Games/Alpha2', name: 'Alpha2' },
    ]);
    expect(result.get('/Games/Alpha1')).toBe('Alpha');
    expect(result.get('/Games/Alpha2')).toBe('Alpha');
  });

  it('skips names that produce only separator characters (line 21 TRUE)', () => {
    // '---' has no letter/digit group → inferGroupBase returns null
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/---', name: '---' },
      { path: '/Games/___', name: '___' },
    ]);
    expect(result.size).toBe(0);
  });

  it('skips names with prefix shorter than 2 chars (line 23 TRUE)', () => {
    // 'a1', 'a2' - base regex gives prefix '' which is too short
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/a1.d64', name: 'a1.d64' },
      { path: '/Games/a2.d64', name: 'a2.d64' },
    ]);
    expect(result.size).toBe(0);
  });
});
