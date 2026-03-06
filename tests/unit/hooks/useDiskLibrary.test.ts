/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, act } from '@testing-library/react';
import {
  useDiskLibrary,
  buildDiskEntryFromDrive,
  toDisplayName,
} from '@/hooks/useDiskLibrary';
import { loadDiskLibrary, saveDiskLibrary } from '@/lib/disks/diskStore';
import { buildDiskTreeState } from '@/lib/disks/diskTree';
import { createDiskEntry } from '@/lib/disks/diskTypes';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/disks/diskStore');
vi.mock('@/lib/disks/diskTree');
vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
}));

describe('useDiskLibrary', () => {
  const mockUniqueId = 'test-id';
  const mockDisk = createDiskEntry({
    path: '/some/path.d64',
    location: 'local',
    name: 'Test Disk',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadDiskLibrary).mockReturnValue({ disks: [] });
    vi.mocked(buildDiskTreeState).mockReturnValue({
      groups: [],
      files: [],
      allFiles: [],
      empty: true,
    });
  });

  it('initializes with empty state and loads from store', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    expect(loadDiskLibrary).toHaveBeenCalledWith(mockUniqueId);
    expect(result.current.disks).toEqual([]);
  });

  it('loads disks from store on mount', () => {
    vi.mocked(loadDiskLibrary).mockReturnValue({
      disks: [mockDisk],
    });

    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    expect(result.current.disks).toHaveLength(1);
    expect(result.current.disks[0].id).toBe(mockDisk.id);
  });

  it('does not load if uniqueId is null', () => {
    renderHook(() => useDiskLibrary(null));
    expect(loadDiskLibrary).not.toHaveBeenCalled();
  });

  it('saves to store when disks change', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    act(() => {
      result.current.addDisks([mockDisk]);
    });

    // Check specific call arguments if needed, but last call should reflect added disk
    expect(saveDiskLibrary).toHaveBeenLastCalledWith(
      mockUniqueId,
      expect.objectContaining({
        disks: expect.arrayContaining([
          expect.objectContaining({ id: mockDisk.id }),
        ]),
      }),
    );
  });

  it('adds disks correctly', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));
    const newDisk = createDiskEntry({ path: '/other.d64', location: 'local' });

    act(() => {
      result.current.addDisks([newDisk]);
    });

    expect(result.current.disks).toHaveLength(1);
    expect(result.current.disks[0].id).toBe(newDisk.id);
  });

  it('does not add duplicate disks', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));
    const disk1 = createDiskEntry({ path: '/disk1.d64', location: 'local' });

    act(() => {
      result.current.addDisks([disk1]);
    });

    act(() => {
      result.current.addDisks([disk1]);
    });

    expect(result.current.disks).toHaveLength(1);
  });

  it('removes disks', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    act(() => {
      result.current.addDisks([mockDisk]);
    });

    expect(result.current.disks).toHaveLength(1);

    act(() => {
      result.current.removeDisk(mockDisk.id);
    });

    expect(result.current.disks).toHaveLength(0);
  });

  it('updates disk group', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    act(() => {
      result.current.addDisks([mockDisk]);
    });

    act(() => {
      result.current.updateDiskGroup(mockDisk.id, 'New Group');
    });

    expect(result.current.disks[0].group).toBe('New Group');

    act(() => {
      result.current.updateDiskGroup(mockDisk.id, null);
    });

    expect(result.current.disks[0].group).toBeNull();
  });

  it('updates disk name', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    act(() => {
      result.current.addDisks([mockDisk]);
    });

    act(() => {
      result.current.updateDiskName(mockDisk.id, 'New Name');
    });

    expect(result.current.disks[0].name).toBe('New Name');
  });

  it('gets disk by id', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    act(() => {
      result.current.addDisks([mockDisk]);
    });

    const found = result.current.getDiskById(mockDisk.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(mockDisk.id);
  });

  it('manages filter state', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));

    act(() => {
      result.current.setFilter('filtered');
    });

    expect(result.current.filter).toBe('filtered');
    expect(buildDiskTreeState).toHaveBeenCalledWith(
      expect.anything(),
      'filtered',
    );
  });

  it('adds disks with runtime files and removes them', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));
    const runtimeFile = new File(['data'], 'disk.d64');
    const disk = createDiskEntry({ path: '/runtime.d64', location: 'local' });

    act(() => {
      result.current.addDisks([disk], { [disk.id]: runtimeFile });
    });

    expect(result.current.runtimeFiles[disk.id]).toBe(runtimeFile);

    act(() => {
      result.current.removeDisk(disk.id);
    });

    expect(result.current.runtimeFiles[disk.id]).toBeUndefined();
    expect(result.current.disks).toHaveLength(0);
  });

  it('removeDisk is a no-op on runtimeFiles when disk has no runtime file', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));
    const disk = createDiskEntry({ path: '/nodisk.d64', location: 'local' });

    act(() => {
      result.current.addDisks([disk]);
    });
    act(() => {
      result.current.removeDisk(disk.id);
    });

    expect(result.current.disks).toHaveLength(0);
  });

  it('updateDiskName falls back to existing name when empty string passed', () => {
    const { result } = renderHook(() => useDiskLibrary(mockUniqueId));
    const disk = createDiskEntry({
      path: '/path.d64',
      location: 'local',
      name: 'Original',
    });

    act(() => {
      result.current.addDisks([disk]);
    });
    act(() => {
      result.current.updateDiskName(disk.id, '');
    });

    expect(result.current.disks[0].name).toBe('Original');
  });
});

describe('buildDiskEntryFromDrive', () => {
  it('returns null when path is null', () => {
    expect(buildDiskEntryFromDrive('local', null)).toBeNull();
  });

  it('returns null when path is undefined', () => {
    expect(buildDiskEntryFromDrive('local', undefined)).toBeNull();
  });

  it('returns disk id string for valid path', () => {
    const result = buildDiskEntryFromDrive('local', '/disks/game.d64');
    expect(typeof result).toBe('string');
    expect(result).toContain('local:');
  });
});

describe('toDisplayName', () => {
  it('uses disk.name when present', () => {
    const disk = createDiskEntry({
      path: '/path/game.d64',
      location: 'local',
      name: 'My Game',
    });
    expect(toDisplayName(disk)).toBe('My Game');
  });

  it('derives name from path when disk.name is absent', () => {
    const disk = createDiskEntry({ path: '/path/game.d64', location: 'local' });
    // createDiskEntry may or may not set name; override to ensure it is empty
    const diskWithoutName = { ...disk, name: '' };
    expect(toDisplayName(diskWithoutName)).toBe('game.d64');
  });
});
