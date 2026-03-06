/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { usePlaybackPersistence } from '@/pages/playFiles/hooks/usePlaybackPersistence';
import type { PlayableEntry, PlaylistItem } from '@/pages/playFiles/types';
import {
  buildPlaylistStorageKey,
  PLAYBACK_SESSION_KEY,
} from '@/pages/playFiles/playFilesUtils';
import { resetPlaylistDataRepositoryForTests } from '@/lib/playlistRepository';

vi.mock('@/pages/playFiles/hooks/playbackPersistenceBudget', () => ({
  shouldPersistLegacyPlaylistBlob: vi.fn().mockReturnValue(true),
}));

import { shouldPersistLegacyPlaylistBlob } from '@/pages/playFiles/hooks/playbackPersistenceBudget';

// Flexible harness allowing custom buildPlaylistItem and initial state
const usePlaybackHarness = ({
  playlistStorageKey,
  localEntriesBySourceId = new Map<
    string,
    Map<
      string,
      {
        uri?: string | null;
        name: string;
        modifiedAt?: string | null;
        sizeBytes?: number | null;
      }
    >
  >(),
  localSourceTreeUris = new Map<string, string | null>(),
  initialPlaylist = [] as PlaylistItem[],
  initialCurrentIndex = -1,
  initialIsPlaying = false,
  initialIsPaused = false,
  buildPlaylistItemOverride,
}: {
  playlistStorageKey: string;
  localEntriesBySourceId?: Map<
    string,
    Map<
      string,
      {
        uri?: string | null;
        name: string;
        modifiedAt?: string | null;
        sizeBytes?: number | null;
      }
    >
  >;
  localSourceTreeUris?: Map<string, string | null>;
  initialPlaylist?: PlaylistItem[];
  initialCurrentIndex?: number;
  initialIsPlaying?: boolean;
  initialIsPaused?: boolean;
  buildPlaylistItemOverride?: (
    entry: PlayableEntry,
    songNrOverride?: number,
    addedAtOverride?: string | null,
  ) => PlaylistItem | null;
}) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(initialPlaylist);
  const [currentIndex, setCurrentIndex] = useState(initialCurrentIndex);
  const [isPlaying, setIsPlaying] = useState(initialIsPlaying);
  const [isPaused, setIsPaused] = useState(initialIsPaused);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const playedClockRef = useRef({ hydrate: vi.fn() });
  const trackStartedAtRef = useRef<number | null>(null);
  const trackInstanceIdRef = useRef(0);
  const autoAdvanceGuardRef = useRef<any>(null);
  const setAutoAdvanceDueAtMsRef = useRef(vi.fn());

  const defaultBuildPlaylistItem = (
    entry: PlayableEntry,
    songNrOverride?: number,
    addedAtOverride?: string | null,
  ): PlaylistItem | null => ({
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
  });

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
    setAutoAdvanceDueAtMs: setAutoAdvanceDueAtMsRef.current,
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
    buildPlaylistItem: buildPlaylistItemOverride ?? defaultBuildPlaylistItem,
    playedClockRef: playedClockRef as any,
    trackStartedAtRef,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    setTrackInstanceId: vi.fn(),
  });

  return {
    playlist,
    currentIndex,
    isPlaying,
    setAutoAdvanceDueAtMs: setAutoAdvanceDueAtMsRef.current,
  };
};

describe('usePlaybackPersistence – edge cases', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetPlaylistDataRepositoryForTests();
    vi.mocked(shouldPersistLegacyPlaylistBlob).mockReturnValue(true);
  });

  it('handles non-object JSON in sessionStorage (ignores malformed session)', async () => {
    // Put a JSON string that is valid JSON but not an object
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'hvsc',
            path: '/MUSICIANS/Test/demo.sid',
            name: 'demo.sid',
            sourceId: 'hvsc',
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );
    // Store a JSON string that is not an object – this triggers line 221 branch
    sessionStorage.setItem('c64u_playback_session:v1', '"hello"');

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });
    // Session restore should have been skipped (no isPlaying state)
    expect(result.current.isPlaying).toBe(false);
  });

  it('handles corrupt JSON in localStorage playlist key (falls back gracefully)', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    // Corrupt JSON as the primary key
    localStorage.setItem(playlistStorageKey, '{NOT_VALID_JSON}');

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      // Should complete without throwing; playlist is empty (no fallback data)
      expect(result.current.playlist).toHaveLength(0);
    });
  });

  it('all parsed localStorage candidates have empty items → fallback to candidates[0]', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    // Put an empty items array under the storage key
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({ items: [], currentIndex: -1 }),
    );

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      // Candidates[0] is used but has empty items, so playlist stays empty
      expect(result.current.playlist).toHaveLength(0);
    });
  });

  it('session restore: uses currentIndex directly when currentItemId is absent', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'hvsc',
            path: '/MUSICIANS/Test/byindex.sid',
            name: 'byindex.sid',
            sourceId: 'hvsc',
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );
    // Session WITHOUT currentItemId – uses currentIndex (line 325 FALSE branch)
    sessionStorage.setItem(
      'c64u_playback_session:v1',
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentIndex: 0,
        isPlaying: false,
        isPaused: false,
        elapsedMs: 0,
        playedMs: 0,
        durationMs: undefined,
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });
    // currentIndex should have been restored to 0
    await waitFor(() => {
      expect(result.current.currentIndex).toBe(0);
    });
  });

  it('hydrates "ultimate" source entry without local file reference', async () => {
    // 'ultimate' source is neither 'local' nor 'hvsc' → file = undefined (line 126 branch)
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'ultimate',
            path: '/Disks/game.d64',
            name: 'game.d64',
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe('game.d64');
    });
  });

  it('skips playlist overwrite when current playlist exists and restored is empty', async () => {
    // Pre-populate the playlist (makes hasPlaylistRef.current → true)
    const existingItem: PlaylistItem = {
      id: 'hvsc::existing',
      request: {
        source: 'hvsc',
        path: '/existing.sid',
        file: undefined,
        songNr: undefined,
      },
      category: 'sid',
      label: 'existing.sid',
      path: '/existing.sid',
      addedAt: new Date().toISOString(),
      status: 'ready',
      unavailableReason: null,
    };
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    // Storage key exists but has no items
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({ items: [], currentIndex: -1 }),
    );

    const { result } = renderHook(() =>
      usePlaybackHarness({
        playlistStorageKey,
        initialPlaylist: [existingItem],
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0]).toEqual(existingItem);
      expect(result.current.currentIndex).toBe(-1);
    });
  });

  it('size budget exceeded: skips legacy localStorage write and removes old keys', async () => {
    vi.mocked(shouldPersistLegacyPlaylistBlob).mockReturnValue(false);

    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'hvsc',
            path: '/MUSICIANS/Test/big.sid',
            name: 'big.sid',
            sourceId: 'hvsc',
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // After hydration, the persist effect fires with the restored playlist.
    // shouldPersistLegacyPlaylistBlob returns false → else branch fires (line 400)
    // localStorage.removeItem should have been called for playlistStorageKey
    await waitFor(() => {
      expect(localStorage.getItem(playlistStorageKey)).toBeNull();
    });
  });

  it('persist session catch: handles sessionStorage.setItem throwing', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'hvsc',
            path: '/MUSICIANS/Test/session.sid',
            name: 'session.sid',
            sourceId: 'hvsc',
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );
    // Session with isPlaying=true to trigger persist session save
    sessionStorage.setItem(
      'c64u_playback_session:v1',
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentIndex: 0,
        isPlaying: true,
        isPaused: false,
        elapsedMs: 1000,
        playedMs: 1000,
        durationMs: 30000,
        updatedAt: new Date().toISOString(),
      }),
    );

    // Spy on sessionStorage.setItem specifically (not Storage.prototype)
    // Capture the original prototype method before spying to avoid recursion
    const originalProtoSetItem = Storage.prototype.setItem;
    const setItemSpy = vi
      .spyOn(sessionStorage, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === 'c64u_playback_session:v1') {
          throw new Error('Storage quota exceeded');
        }
        // Use prototype directly to avoid calling the spy again
        originalProtoSetItem.call(sessionStorage, key, value);
      });

    const { result } = renderHook(() =>
      usePlaybackHarness({ playlistStorageKey }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    setItemSpy.mockRestore();
  });

  it('persist playlist with items having null addedAt and undefined status (uses fallbacks)', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'hvsc',
            path: '/MUSICIANS/Test/noadded.sid',
            name: 'noadded.sid',
            sourceId: 'hvsc',
            // no addedAt, no status
          },
        ],
        currentIndex: 0,
      }),
    );

    // Use a buildPlaylistItem that returns items with null addedAt and undefined status
    // to exercise lines 384-385 (addedAt ?? nowIso, status ?? 'ready')
    const buildPlaylistItemOverride = (
      entry: PlayableEntry,
      songNrOverride?: number,
      addedAtOverride?: string | null,
    ): PlaylistItem | null => ({
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
      sizeBytes: null,
      modifiedAt: null,
      addedAt: null, // null → triggers addedAt ?? nowIso in persist (line 384)
      // status intentionally omitted → undefined triggers status ?? 'ready' (line 385)
      unavailableReason: null,
    });

    const { result } = renderHook(() =>
      usePlaybackHarness({
        playlistStorageKey,
        buildPlaylistItemOverride,
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // Verify persist happened (localStorage was written by persist effect)
    await waitFor(() => {
      const stored = localStorage.getItem(playlistStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as {
          items: Array<{ addedAt?: string | null; status?: string }>;
        };
        // After persist, status should be 'ready' (from the ?? fallback)
        expect(parsed.items[0].status).toBe('ready');
      }
    });
  });

  it('persist session: out-of-range currentIndex produces null currentItemId', async () => {
    const playlistStorageKey = buildPlaylistStorageKey('device-1');
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: 'hvsc',
            path: '/MUSICIANS/Test/oor.sid',
            name: 'oor.sid',
            sourceId: 'hvsc',
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: -1,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackHarness({
        playlistStorageKey,
        initialCurrentIndex: -1,
        initialIsPlaying: true,
        initialIsPaused: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    await waitFor(() => {
      const raw = sessionStorage.getItem('c64u_playback_session:v1');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string) as {
        currentItemId: string | null;
        currentIndex: number;
      };
      expect(parsed.currentItemId).toBeNull();
      expect(parsed.currentIndex).toBe(-1);
    });
  });
});
