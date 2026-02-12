/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { usePlaybackPersistence } from '@/pages/playFiles/hooks/usePlaybackPersistence';
import type { PlayableEntry, PlaylistItem } from '@/pages/playFiles/types';
import { buildPlaylistStorageKey } from '@/pages/playFiles/playFilesUtils';
import { resetPlaylistDataRepositoryForTests } from '@/lib/playlistRepository';

const usePlaybackPersistenceHarness = ({
  playlistStorageKey,
  localEntriesBySourceId,
  localSourceTreeUris,
}: {
  playlistStorageKey: string;
  localEntriesBySourceId: Map<string, Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>>;
  localSourceTreeUris: Map<string, string | null>;
}) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const playedClockRef = useRef({
    hydrate: vi.fn(),
  });
  const trackStartedAtRef = useRef<number | null>(null);
  const trackInstanceIdRef = useRef(0);
  const autoAdvanceGuardRef = useRef<any>(null);

  usePlaybackPersistence({
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    isPlaying,
    setIsPlaying,
    isPaused,
    setIsPaused,
    elapsedMs,
    setElapsedMs,
    playedMs,
    setPlayedMs,
    durationMs,
    setDurationMs,
    setCurrentSubsongCount: vi.fn(),
    resolvedDeviceId: 'device-1',
    playlistStorageKey,
    localEntriesBySourceId,
    localSourceTreeUris,
    buildHvscLocalPlayFile: (path, name) => ({
      name,
      webkitRelativePath: path,
      lastModified: Date.now(),
      arrayBuffer: async () => new ArrayBuffer(4),
    }),
    buildPlaylistItem: (entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null) => ({
      id: `${entry.source}:${entry.sourceId ?? ''}:${entry.path}`,
      request: {
        source: entry.source,
        path: entry.path,
        file: entry.file,
        songNr: songNrOverride,
      },
      category: 'sid',
      label: entry.name,
      path: entry.path,
      durationMs: entry.durationMs,
      sourceId: entry.sourceId ?? null,
      sizeBytes: entry.sizeBytes ?? null,
      modifiedAt: entry.modifiedAt ?? null,
      addedAt: addedAtOverride ?? new Date().toISOString(),
      status: 'ready',
      unavailableReason: null,
    }),
    playedClockRef: playedClockRef as any,
    trackStartedAtRef,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    setTrackInstanceId: vi.fn(),
  });

  return {
    playlist,
    currentIndex,
  };
};

describe('usePlaybackPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetPlaylistDataRepositoryForTests();
  });

  it('restores persisted local playlist items', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(playlistStorageKey, JSON.stringify({
      items: [
        {
          source: 'local',
          path: '/Music/demo.sid',
          name: 'demo.sid',
          sourceId: 'local-source',
          addedAt: new Date().toISOString(),
        },
      ],
      currentIndex: 0,
    }));

    const localEntriesBySourceId = new Map([
      ['local-source', new Map([['/Music/demo.sid', { name: 'demo.sid' }]])],
    ]);
    const localSourceTreeUris = new Map<string, string | null>();

    const { result } = renderHook(() => usePlaybackPersistenceHarness({
      playlistStorageKey,
      localEntriesBySourceId,
      localSourceTreeUris,
    }));

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe('demo.sid');
      expect(result.current.playlist[0].status).toBe('ready');
    });
  });

  it('restores persisted HVSC playlist items', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(playlistStorageKey, JSON.stringify({
      items: [
        {
          source: 'hvsc',
          path: '/MUSICIANS/Test/demo.sid',
          name: 'demo.sid',
          sourceId: 'hvsc-library',
          addedAt: new Date().toISOString(),
        },
      ],
      currentIndex: 0,
    }));

    const { result } = renderHook(() => usePlaybackPersistenceHarness({
      playlistStorageKey,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
    }));

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe('demo.sid');
      expect(result.current.playlist[0].request.source).toBe('hvsc');
    });
  });

  it('hydrates from repository data when legacy playlist payload is absent', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem('c64u_playlist_repo:v1', JSON.stringify({
      version: 1,
      tracks: {
        'hvsc::/MUSICIANS/Test/repo.sid': {
          trackId: 'hvsc::/MUSICIANS/Test/repo.sid',
          sourceKind: 'hvsc',
          sourceLocator: '/MUSICIANS/Test/repo.sid',
          category: 'sid',
          title: 'repo.sid',
          author: null,
          released: null,
          path: '/MUSICIANS/Test/repo.sid',
          sizeBytes: null,
          modifiedAt: null,
          defaultDurationMs: 1000,
          subsongCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      playlistItemsByPlaylistId: {
        [playlistStorageKey]: [
          {
            playlistItemId: 'repo-item-1',
            playlistId: playlistStorageKey,
            trackId: 'hvsc::/MUSICIANS/Test/repo.sid',
            songNr: 1,
            sortKey: '00000001',
            durationOverrideMs: null,
            status: 'ready',
            unavailableReason: null,
            addedAt: new Date().toISOString(),
          },
        ],
      },
      sessionsByPlaylistId: {},
      randomSessionsByPlaylistId: {},
    }));

    const { result } = renderHook(() => usePlaybackPersistenceHarness({
      playlistStorageKey,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
    }));

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe('repo.sid');
      expect(result.current.playlist[0].request.source).toBe('hvsc');
    });
  });
});
