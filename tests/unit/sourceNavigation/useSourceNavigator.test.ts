/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceLocation } from '@/lib/sourceNavigation/types';
import { useSourceNavigator } from '@/lib/sourceNavigation/useSourceNavigator';
import { addErrorLog } from '@/lib/logging';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
}));

describe('useSourceNavigator', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('loads stored path and toggles the loading indicator for ultimate sources', async () => {
    vi.useFakeTimers();
    let resolveEntries: ((value: { type: 'file'; name: string; path: string }[]) => void) | null = null;
    const listEntries = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveEntries = resolve;
      }),
    );
    const source: SourceLocation = {
      id: 'ultimate-1',
      type: 'ultimate',
      name: 'Ultimate',
      rootPath: '/root',
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    localStorage.setItem('c64u_source_nav:ultimate:ultimate-1', '/root');

    const { result } = renderHook(() => useSourceNavigator(source));

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current.showLoadingIndicator).toBe(true);

    await act(async () => {
      resolveEntries?.([{ type: 'file', name: 'song.sid', path: '/root/song.sid' }]);
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.path).toBe('/root');

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.showLoadingIndicator).toBe(false);

    vi.useRealTimers();
  });

  it('navigates up and refresh clears cache', async () => {
    const listEntries = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ type: 'dir', name: 'Child', path: '/root/child' }])
      .mockResolvedValueOnce([]);
    const clearCacheForPath = vi.fn();
    const source: SourceLocation = {
      id: 'local-1',
      type: 'local',
      name: 'Local',
      rootPath: '/root',
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
      clearCacheForPath,
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.navigateTo('/root/child');
    });

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.navigateUp();
    });

    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(3));

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(clearCacheForPath).toHaveBeenCalledWith(result.current.path));
  });

  it('captures list errors and reports them', async () => {
    const listEntries = vi.fn().mockRejectedValue(new Error('Boom'));
    const source: SourceLocation = {
      id: 'ultimate-2',
      type: 'ultimate',
      name: 'Ultimate',
      rootPath: '/root',
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    await waitFor(() => expect(result.current.error).toBe('Boom'));
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      'Source browse failed',
      expect.objectContaining({
        sourceId: 'ultimate-2',
        sourceType: 'ultimate',
        path: '/root',
      }),
    );
  });

  it('discards stale responses when a newer navigation fires', async () => {
    type Resolver = (entries: { type: string; name: string; path: string }[]) => void;
    const resolvers: Resolver[] = [];
    const listEntries = vi.fn().mockImplementation(
      () => new Promise<{ type: string; name: string; path: string }[]>((resolve) => {
        resolvers.push(resolve);
      }),
    );
    const source: SourceLocation = {
      id: 'race-1',
      type: 'local',
      name: 'Local',
      rootPath: '/',
      isAvailable: true,
      listEntries,
      listFilesRecursive: vi.fn(),
    };

    const { result } = renderHook(() => useSourceNavigator(source));

    // Wait for the initial load call
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(1));

    // Resolve initial load
    await act(async () => {
      resolvers[0]([{ type: 'dir', name: 'A', path: '/A' }]);
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.path).toBe('/');

    // Fire two navigations quickly — second should win
    act(() => {
      result.current.navigateTo('/A');
    });
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.navigateTo('/B');
    });
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(3));

    // Resolve the FIRST navigation (stale — /A) AFTER the second was dispatched
    await act(async () => {
      resolvers[1]([{ type: 'file', name: 'stale.sid', path: '/A/stale.sid' }]);
    });

    // Stale result should NOT appear — entries should still be from initial load
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].name).toBe('A');

    // Now resolve the SECOND navigation (current — /B)
    await act(async () => {
      resolvers[2]([{ type: 'file', name: 'current.sid', path: '/B/current.sid' }]);
    });

    // Current result should appear
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].name).toBe('current.sid');
    expect(result.current.path).toBe('/B');
  });
});
