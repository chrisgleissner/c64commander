/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { usePlaybackPersistence } from "@/pages/playFiles/hooks/usePlaybackPersistence";
import type { PlayableEntry, PlaylistItem } from "@/pages/playFiles/types";
import { PLAYBACK_SESSION_KEY, buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import { resetPlaylistDataRepositoryForTests } from "@/lib/playlistRepository";

const PLAYLIST_REPOSITORY_STORAGE_KEY = "c64u_playlist_repo:v1";

const usePlaybackPersistenceHarness = ({
  resolvedDeviceId = "device-1",
  playlistStorageKey,
  localEntriesBySourceId,
  localSourceTreeUris,
}: {
  resolvedDeviceId?: string | null;
  playlistStorageKey: string;
  localEntriesBySourceId: Map<
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

  const setAutoAdvanceDueAtMsRef = useRef(vi.fn());

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
    resolvedDeviceId,
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
      id: `${entry.source}:${entry.sourceId ?? ""}:${entry.path}`,
      request: {
        source: entry.source,
        path: entry.path,
        file: entry.file,
        songNr: songNrOverride,
      },
      category: "sid",
      label: entry.name,
      path: entry.path,
      configRef: entry.configRef ?? null,
      archiveRef: entry.archiveRef ?? null,
      durationMs: entry.durationMs,
      subsongCount: entry.subsongCount,
      sourceId: entry.sourceId ?? null,
      sizeBytes: entry.sizeBytes ?? null,
      modifiedAt: entry.modifiedAt ?? null,
      addedAt: addedAtOverride ?? new Date().toISOString(),
      status: "ready",
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
    setAutoAdvanceDueAtMs: setAutoAdvanceDueAtMsRef.current,
  };
};

describe("usePlaybackPersistence", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetPlaylistDataRepositoryForTests();
  });

  it("restores persisted local playlist items", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "local",
            path: "/Music/demo.sid",
            name: "demo.sid",
            sourceId: "local-source",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const localEntriesBySourceId = new Map([["local-source", new Map([["/Music/demo.sid", { name: "demo.sid" }]])]]);
    const localSourceTreeUris = new Map<string, string | null>();

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId,
        localSourceTreeUris,
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("demo.sid");
      expect(result.current.playlist[0].status).toBe("ready");
    });
  });

  it("hydrates persisted playlist items during the initial render before repository migration finishes", () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/immediate.sid",
            name: "immediate.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    expect(result.current.playlist).toHaveLength(1);
    expect(result.current.playlist[0].label).toBe("immediate.sid");
  });

  it("rehydrates local playlist items from persisted SAF entry URIs", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "local",
            path: "/Music/demo.sid",
            name: "demo.sid",
            sourceId: "local-source",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const localEntriesBySourceId = new Map([
      [
        "local-source",
        new Map([
          [
            "/Music/demo.sid",
            {
              name: "demo.sid",
              uri: "content://demo.sid",
              modifiedAt: "2026-03-29T18:00:00Z",
              sizeBytes: 8192,
            },
          ],
        ]),
      ],
    ]);

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId,
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].request.file).toMatchObject({
        name: "demo.sid",
        webkitRelativePath: "/Music/demo.sid",
      });
      expect(result.current.playlist[0].sizeBytes).toBe(8192);
      expect(result.current.playlist[0].modifiedAt).toBe("2026-03-29T18:00:00Z");
    });
  });

  it("rehydrates local playlist items from persisted tree URIs when SAF entry URIs are absent", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "local",
            path: "/Music/tree-demo.sid",
            name: "tree-demo.sid",
            sourceId: "local-source",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map([
          ["local-source", new Map([["/Music/tree-demo.sid", { name: "tree-demo.sid" }]])],
        ]),
        localSourceTreeUris: new Map([["local-source", "content://tree-root"]]),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].request.file).toMatchObject({
        name: "tree-demo.sid",
        webkitRelativePath: "/Music/tree-demo.sid",
      });
    });
  });

  it("restores config associations from legacy playlist blobs", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "local",
            path: "/Music/demo.sid",
            name: "demo.sid",
            sourceId: "local-source",
            configRef: {
              kind: "ultimate",
              fileName: "demo.cfg",
              path: "/USB1/test-data/snapshots/demo.cfg",
            },
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const localEntriesBySourceId = new Map([["local-source", new Map([["/Music/demo.sid", { name: "demo.sid" }]])]]);

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId,
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].configRef).toEqual({
        kind: "ultimate",
        fileName: "demo.cfg",
        path: "/USB1/test-data/snapshots/demo.cfg",
      });
    });
  });

  it("restores persisted HVSC playlist items", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/demo.sid",
            name: "demo.sid",
            sourceId: "hvsc-library",
            subsongCount: 4,
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("demo.sid");
      expect(result.current.playlist[0].request.source).toBe("hvsc");
      expect(result.current.playlist[0].request.file).toBeUndefined();
      expect(result.current.playlist[0].subsongCount).toBe(4);
    });
  });

  it("rehydrates a legacy per-device playlist while the shared playlist key is active", async () => {
    const devicePlaylistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      devicePlaylistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/delayed.sid",
            name: "delayed.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result, rerender } = renderHook(
      ({ resolvedDeviceId, playlistStorageKey }) =>
        usePlaybackPersistenceHarness({
          resolvedDeviceId,
          playlistStorageKey,
          localEntriesBySourceId: new Map(),
          localSourceTreeUris: new Map(),
        }),
      {
        initialProps: {
          resolvedDeviceId: null as string | null,
          playlistStorageKey: buildPlaylistStorageKey("default"),
        },
      },
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("delayed.sid");
    });

    rerender({
      resolvedDeviceId: "device-1",
      playlistStorageKey: devicePlaylistStorageKey,
    });

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("delayed.sid");
    });
  });

  it("restores persisted CommoServe archive references", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "commoserve",
            path: "joyride.sid",
            name: "Joyride",
            sourceId: "archive-commoserve",
            archiveRef: {
              sourceId: "archive-commoserve",
              resultId: "100",
              category: 40,
              entryId: 1,
              entryPath: "joyride.sid",
            },
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].request.source).toBe("commoserve");
      expect(result.current.playlist[0].archiveRef).toEqual({
        sourceId: "archive-commoserve",
        resultId: "100",
        category: 40,
        entryId: 1,
        entryPath: "joyride.sid",
      });
    });
  });

  it("hydrates from repository data when legacy playlist payload is absent", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "hvsc::/MUSICIANS/Test/repo.sid": {
            trackId: "hvsc::/MUSICIANS/Test/repo.sid",
            sourceKind: "hvsc",
            sourceLocator: "/MUSICIANS/Test/repo.sid",
            category: "sid",
            title: "repo.sid",
            author: null,
            released: null,
            path: "/MUSICIANS/Test/repo.sid",
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
              playlistItemId: "repo-item-1",
              playlistId: playlistStorageKey,
              trackId: "hvsc::/MUSICIANS/Test/repo.sid",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("repo.sid");
      expect(result.current.playlist[0].request.source).toBe("hvsc");
      expect(result.current.playlist[0].request.file).toBeUndefined();
      expect(result.current.playlist[0].subsongCount).toBe(1);
    });
  });

  it("hydrates repository-backed local tracks with explicit sourceId", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "local:local-source:/Music/repo-local.sid": {
            trackId: "local:local-source:/Music/repo-local.sid",
            sourceKind: "local",
            sourceLocator: "/Music/repo-local.sid",
            sourceId: "local-source",
            category: "sid",
            title: "repo-local.sid",
            author: null,
            released: null,
            path: "/Music/repo-local.sid",
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
              playlistItemId: "repo-item-local-1",
              playlistId: playlistStorageKey,
              trackId: "local:local-source:/Music/repo-local.sid",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map([
          ["local-source", new Map([["/Music/repo-local.sid", { name: "repo-local.sid" }]])],
        ]),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].sourceId).toBe("local-source");
      expect(result.current.playlist[0].request.source).toBe("local");
    });
  });

  it("hydrates repository-backed tracks with persisted config associations", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "ultimate::/MUSICIANS/Test/repo.sid": {
            trackId: "ultimate::/MUSICIANS/Test/repo.sid",
            sourceKind: "ultimate",
            sourceLocator: "/MUSICIANS/Test/repo.sid",
            category: "sid",
            title: "repo.sid",
            author: null,
            released: null,
            path: "/MUSICIANS/Test/repo.sid",
            configRef: {
              kind: "local",
              fileName: "repo.cfg",
              uri: "content://repo.cfg",
            },
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
              playlistItemId: "repo-item-config-1",
              playlistId: playlistStorageKey,
              trackId: "ultimate::/MUSICIANS/Test/repo.sid",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].configRef).toEqual({
        kind: "local",
        fileName: "repo.cfg",
        uri: "content://repo.cfg",
      });
    });
  });

  it("hydrates legacy repository local tracks by recovering sourceId from trackId", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "local:legacy-source:/Music/repo-legacy.sid": {
            trackId: "local:legacy-source:/Music/repo-legacy.sid",
            sourceKind: "local",
            sourceLocator: "/Music/repo-legacy.sid",
            category: "sid",
            title: "repo-legacy.sid",
            author: null,
            released: null,
            path: "/Music/repo-legacy.sid",
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
              playlistItemId: "repo-item-local-legacy-1",
              playlistId: playlistStorageKey,
              trackId: "local:legacy-source:/Music/repo-legacy.sid",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map([
          ["legacy-source", new Map([["/Music/repo-legacy.sid", { name: "repo-legacy.sid" }]])],
        ]),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].sourceId).toBe("legacy-source");
      expect(result.current.playlist[0].request.source).toBe("local");
    });
  });

  it("hydrates repository local tracks by reusing non-path source locators as source ids", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "local::/Music/repo-locator.sid": {
            trackId: "local::/Music/repo-locator.sid",
            sourceKind: "local",
            sourceLocator: "locator-source",
            category: "sid",
            title: "repo-locator.sid",
            author: null,
            released: null,
            path: "/Music/repo-locator.sid",
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
              playlistItemId: "repo-item-local-locator-1",
              playlistId: playlistStorageKey,
              trackId: "local::/Music/repo-locator.sid",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map([
          ["locator-source", new Map([["/Music/repo-locator.sid", { name: "repo-locator.sid" }]])],
        ]),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].sourceId).toBe("locator-source");
      expect(result.current.playlist[0].request.source).toBe("local");
    });
  });

  it("leaves repository local track source ids empty when legacy track ids cannot be parsed", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "local:broken": {
            trackId: "local:broken",
            sourceKind: "local",
            sourceLocator: "/Music/repo-broken.sid",
            category: "sid",
            title: "repo-broken.sid",
            author: null,
            released: null,
            path: "/Music/repo-broken.sid",
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
              playlistItemId: "repo-item-local-broken-1",
              playlistId: playlistStorageKey,
              trackId: "local:broken",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].sourceId).toBeNull();
      expect(result.current.playlist[0].request.source).toBe("local");
    });
  });

  it("leaves repository local track source ids empty when track ids do not use the local legacy prefix", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    localStorage.setItem(
      PLAYLIST_REPOSITORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tracks: {
          "hvsc::/Music/repo-wrong-prefix.sid": {
            trackId: "hvsc::/Music/repo-wrong-prefix.sid",
            sourceKind: "local",
            sourceLocator: "/Music/repo-wrong-prefix.sid",
            category: "sid",
            title: "repo-wrong-prefix.sid",
            author: null,
            released: null,
            path: "/Music/repo-wrong-prefix.sid",
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
              playlistItemId: "repo-item-local-wrong-prefix-1",
              playlistId: playlistStorageKey,
              trackId: "hvsc::/Music/repo-wrong-prefix.sid",
              songNr: 1,
              sortKey: "00000001",
              durationOverrideMs: null,
              status: "ready",
              unavailableReason: null,
              addedAt: new Date().toISOString(),
            },
          ],
        },
        sessionsByPlaylistId: {},
        randomSessionsByPlaylistId: {},
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].sourceId).toBeNull();
      expect(result.current.playlist[0].request.source).toBe("local");
    });
  });

  it("calls setAutoAdvanceDueAtMs with correct value on session restore with duration", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    const durationMs = 60000;
    const elapsedMs = 10000;

    // Seed playlist in localStorage
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/restore.sid",
            name: "restore.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
            durationMs,
          },
        ],
        currentIndex: 0,
      }),
    );

    // Seed session in sessionStorage — playing, not paused, with known duration
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentItemId: "hvsc:hvsc-library:/MUSICIANS/Test/restore.sid",
        currentIndex: 0,
        isPlaying: true,
        isPaused: false,
        elapsedMs,
        playedMs: elapsedMs,
        durationMs,
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // The guard should have been set and setAutoAdvanceDueAtMs called with a numeric value
    await waitFor(() => {
      const calls = result.current.setAutoAdvanceDueAtMs.mock.calls;
      const numericCalls = calls.filter(([v]: [unknown]) => typeof v === "number");
      expect(numericCalls.length).toBeGreaterThanOrEqual(1);
      // The dueAtMs should be approximately trackStartedAt + durationMs
      const dueAt = numericCalls[numericCalls.length - 1][0] as number;
      expect(dueAt).toBeGreaterThan(Date.now() - 120000); // sanity: within last 2 min
      expect(dueAt).toBeLessThan(Date.now() + durationMs + 5000); // sanity: not too far in the future
    });
  });

  it("calls setAutoAdvanceDueAtMs with null on session restore without duration", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");

    // Seed playlist in localStorage — item has NO duration
    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/nodur.sid",
            name: "nodur.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    // Seed session in sessionStorage — playing, no duration
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentItemId: "hvsc:hvsc-library:/MUSICIANS/Test/nodur.sid",
        currentIndex: 0,
        isPlaying: true,
        isPaused: false,
        elapsedMs: 5000,
        playedMs: 5000,
        durationMs: undefined,
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // setAutoAdvanceDueAtMs should have been called with null (no auto-advance without duration)
    await waitFor(() => {
      const calls = result.current.setAutoAdvanceDueAtMs.mock.calls;
      const nullCalls = calls.filter(([v]: [unknown]) => v === null);
      expect(nullCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("skips session restore when playlistKey does not match", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");

    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/demo.sid",
            name: "demo.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    // Session stored with a DIFFERENT playlist key
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: buildPlaylistStorageKey("other-device"),
        currentItemId: "hvsc:hvsc-library:/MUSICIANS/Test/demo.sid",
        currentIndex: 0,
        isPlaying: true,
        isPaused: false,
        elapsedMs: 5000,
        playedMs: 5000,
        durationMs: 60000,
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // Session restore should be skipped due to key mismatch, so no setAutoAdvanceDueAtMs with numeric value
    await waitFor(() => {
      const calls = result.current.setAutoAdvanceDueAtMs.mock.calls;
      const numericCalls = calls.filter(([v]: [unknown]) => typeof v === "number");
      expect(numericCalls.length).toBe(0);
    });
  });

  it("skips session restore when item index is out of range", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");

    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/demo.sid",
            name: "demo.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    // Session refers to an item ID that doesn't exist in the restored playlist
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentItemId: "hvsc:hvsc-library:/MUSICIANS/Test/nonexistent.sid",
        currentIndex: 99,
        isPlaying: true,
        isPaused: false,
        elapsedMs: 5000,
        playedMs: 5000,
        durationMs: 60000,
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // Session restore should be skipped due to out-of-range index
    await waitFor(() => {
      const calls = result.current.setAutoAdvanceDueAtMs.mock.calls;
      const numericCalls = calls.filter(([v]: [unknown]) => typeof v === "number");
      expect(numericCalls.length).toBe(0);
    });
  });

  it("restores from default key when device-specific key is empty", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-2");
    const defaultKey = buildPlaylistStorageKey("default");

    // Only the default key has data
    localStorage.setItem(
      defaultKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/fallback.sid",
            name: "fallback.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("fallback.sid");
    });
  });

  it("restores the first available legacy playlist when the shared playlist key has no data yet", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-2");
    const unrelatedKey = buildPlaylistStorageKey("stale-device");

    localStorage.setItem(
      unrelatedKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/stale.sid",
            name: "stale.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("stale.sid");
    });
  });

  it("restores paused session without starting auto-advance timer", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");

    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/paused.sid",
            name: "paused.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
            durationMs: 60000,
          },
        ],
        currentIndex: 0,
      }),
    );

    // Session stored with isPaused = true
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentItemId: "hvsc:hvsc-library:/MUSICIANS/Test/paused.sid",
        currentIndex: 0,
        isPlaying: false,
        isPaused: true,
        elapsedMs: 10000,
        playedMs: 10000,
        durationMs: 60000,
        updatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });

    // For paused sessions, setAutoAdvanceDueAtMs should be called with null
    await waitFor(() => {
      const calls = result.current.setAutoAdvanceDueAtMs.mock.calls;
      const nullCalls = calls.filter(([v]: [unknown]) => v === null);
      expect(nullCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("restores playlist from local source with tree URI fallback", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");

    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "local",
            path: "/Music/tree-demo.sid",
            name: "tree-demo.sid",
            sourceId: "tree-source",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    // No entry in localEntriesBySourceId, but provide a tree URI
    const localSourceTreeUris = new Map<string, string | null>([["tree-source", "content://tree-uri"]]);

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris,
      }),
    );

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.playlist[0].label).toBe("tree-demo.sid");
    });
  });

  it("handles corrupt JSON in sessionStorage gracefully", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");

    // Corrupt session data
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, "NOT_VALID_JSON");

    localStorage.setItem(
      playlistStorageKey,
      JSON.stringify({
        items: [
          {
            source: "hvsc",
            path: "/MUSICIANS/Test/demo.sid",
            name: "demo.sid",
            sourceId: "hvsc-library",
            addedAt: new Date().toISOString(),
          },
        ],
        currentIndex: 0,
      }),
    );

    const { result } = renderHook(() =>
      usePlaybackPersistenceHarness({
        playlistStorageKey,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
      }),
    );

    // Should still load the playlist despite corrupt session
    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
    });
  });
});
