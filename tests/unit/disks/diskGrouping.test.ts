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

  it('returns empty Map for empty input', () => {
    const result = assignDiskGroupsByPrefix([]);
    expect(result.size).toBe(0);
  });

  it('does not group a single file even when it has a numeric suffix', () => {
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/foo1.d64', name: 'foo1.d64' },
    ]);
    expect(result.get('/Games/foo1.d64')).toBeUndefined();
  });

  it('does not group files whose prefix is too short to be meaningful', () => {
    // 'A1' and 'A2' have prefix 'A' which is length 1 — below the minimum of 2
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/A1.d64', name: 'A1.d64' },
      { path: '/Games/A2.d64', name: 'A2.d64' },
    ]);
    expect(result.get('/Games/A1.d64')).toBeUndefined();
    expect(result.get('/Games/A2.d64')).toBeUndefined();
  });

  it('does not group files without a detectable suffix', () => {
    // Files with no numeric or single-letter suffix are left ungrouped
    const result = assignDiskGroupsByPrefix([
      { path: '/Games/action.d64', name: 'action.d64' },
      { path: '/Games/adventure.d64', name: 'adventure.d64' },
    ]);
    expect(result.get('/Games/action.d64')).toBeUndefined();
    expect(result.get('/Games/adventure.d64')).toBeUndefined();
  });
});
