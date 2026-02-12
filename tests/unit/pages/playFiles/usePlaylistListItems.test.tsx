/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlaylistListItems } from '@/pages/playFiles/hooks/usePlaylistListItems';
import type { PlaylistItem } from '@/pages/playFiles/types';
import { FileOriginIcon } from '@/components/FileOriginIcon';

const buildItem = (source: 'local' | 'ultimate' | 'hvsc', path: string, status: PlaylistItem['status'] = 'ready'): PlaylistItem => ({
  id: `${source}:${path}`,
  request: { source, path },
  category: 'sid',
  label: path.split('/').pop() || path,
  path,
  addedAt: '2026-02-12T00:00:00.000Z',
  status,
  unavailableReason: status === 'unavailable' ? 'file-inaccessible' : null,
});

describe('usePlaylistListItems', () => {
  it('does not include source-kind labels in playlist item details', () => {
    const playlist = [
      buildItem('ultimate', '/USB0/Music/track1.sid'),
      buildItem('local', '/Music/track2.sid'),
      buildItem('hvsc', '/MUSICIANS/Hubbard_Rob/Commando.sid'),
    ];

    const { result } = renderHook(() => usePlaylistListItems({
      filteredPlaylist: playlist,
      playlist,
      selectedPlaylistIds: new Set<string>(),
      isPlaylistLoading: false,
      handlePlaylistSelect: vi.fn(),
      startPlaylist: vi.fn(),
      playlistItemDuration: () => undefined,
      formatTime: () => '—:—',
      formatPlayCategory: () => 'SID',
      formatBytes: () => '—',
      formatDate: () => '—',
      getParentPath: (value: string) => value.slice(0, value.lastIndexOf('/')) || '/',
      currentPlayingItemId: null,
    }));

    const listItems = result.current.filter((entry) => entry.variant !== 'header');
    expect(listItems).toHaveLength(3);

    listItems.forEach((entry) => {
      const sourceInfo = entry.menuItems?.find((menu) => menu.type === 'info' && menu.label === 'Source');
      expect(sourceInfo).toBeUndefined();
      expect(entry.subtitle).toBeTruthy();
      expect(entry.subtitle).not.toContain('This device');
      expect(entry.subtitle).not.toContain('C64 Ultimate');
      expect(entry.subtitle).not.toContain('HVSC');
      const metaChildren = Array.isArray((entry.meta as any)?.props?.children)
        ? (entry.meta as any).props.children
        : [(entry.meta as any)?.props?.children];
      expect(metaChildren.some((child: any) => child?.type === FileOriginIcon)).toBe(true);
    });

    expect(listItems[2]?.subtitle).toBe('/MUSICIANS/Hubbard_Rob/Commando.sid');
  });

  it('uses generic unavailable status metadata', () => {
    const playlist = [buildItem('hvsc', '/MUSICIANS/Hubbard_Rob/Commando.sid', 'unavailable')];

    const { result } = renderHook(() => usePlaylistListItems({
      filteredPlaylist: playlist,
      playlist,
      selectedPlaylistIds: new Set<string>(),
      isPlaylistLoading: false,
      handlePlaylistSelect: vi.fn(),
      startPlaylist: vi.fn(),
      playlistItemDuration: () => undefined,
      formatTime: () => '—:—',
      formatPlayCategory: () => 'SID',
      formatBytes: () => '—',
      formatDate: () => '—',
      getParentPath: (value: string) => value.slice(0, value.lastIndexOf('/')) || '/',
      currentPlayingItemId: null,
    }));

    const row = result.current.find((entry) => entry.variant !== 'header');
    const statusEntry = row?.menuItems?.find((menu) => menu.type === 'info' && menu.label === 'Status');
    expect(statusEntry).toEqual({ type: 'info', label: 'Status', value: 'Unavailable' });
  });
});
