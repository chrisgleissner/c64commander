import { renderHook, act } from '@testing-library/react';
import { useDiskLibrary } from '@/hooks/useDiskLibrary';
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
    expect(saveDiskLibrary).toHaveBeenLastCalledWith(mockUniqueId, expect.objectContaining({
        disks: expect.arrayContaining([expect.objectContaining({ id: mockDisk.id })])
    }));
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
    expect(buildDiskTreeState).toHaveBeenCalledWith(expect.anything(), 'filtered');
  });
});
