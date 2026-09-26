/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { usePlaybackPersistence } from "@/pages/playFiles/hooks/usePlaybackPersistence";
import type { PlayableEntry, PlaylistItem, StoredPlaybackSession } from "@/pages/playFiles/types";
import { buildPlaylistStorageKey, isStoredSessionFromAnotherDevice } from "@/pages/playFiles/playFilesUtils";
import { resetPlaylistDataRepositoryForTests } from "@/lib/playlistRepository";
import { readStoredPlaybackSession, writeStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";

const rig = vi.hoisted(() => ({ selectedDeviceId: "device-b", phonePlaying: false }));
vi.mock("@/lib/savedDevices/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/savedDevices/store")>();
  return {
    ...actual,
    getSavedDevicesSnapshot: () => ({ ...actual.getSavedDevicesSnapshot(), selectedDeviceId: rig.selectedDeviceId }),
  };
});
vi.mock("@/lib/playback/activePlaybackSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/playback/activePlaybackSession")>()),
  isLocalPlaybackActive: () => rig.phonePlaying,
}));

const ITEM_PATH = "/MUSICIANS/Test/tune.sid";
const ITEM_ID = `hvsc:hvsc-library:${ITEM_PATH}`;

const buildPlaylistItem = (entry: PlayableEntry, songNr?: number, addedAt?: string | null): PlaylistItem => ({
  id: `${entry.source}:${entry.sourceId ?? ""}:${entry.path}`,
  request: { source: entry.source, path: entry.path, file: entry.file, songNr },
  category: "sid",
  label: entry.name,
  path: entry.path,
  durationMs: entry.durationMs,
  sourceId: entry.sourceId ?? null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: addedAt ?? new Date().toISOString(),
  status: "ready",
  unavailableReason: null,
});

const useHarness = (playlistStorageKey: string) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  const playedClockRef = useRef({ hydrate: vi.fn() });
  const trackStartedAtRef = useRef<number | null>(null);
  const trackInstanceIdRef = useRef(0);
  const autoAdvanceGuardRef = useRef<{ dueAtMs: number } | null>(null);
  const setAutoAdvanceDueAtMs = useRef(vi.fn()).current;

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
    autoAdvanceDueAtMs: null,
    setCurrentSubsongCount: vi.fn(),
    setAutoAdvanceDueAtMs,
    setSessionRestoreSettled: setSettled,
    resolvedDeviceId: "device-1",
    playlistStorageKey,
    localEntriesBySourceId: new Map(),
    localSourceTreeUris: new Map(),
    buildHvscLocalPlayFile: (path, name) => ({
      name,
      webkitRelativePath: path,
      lastModified: Date.now(),
      arrayBuffer: async () => new ArrayBuffer(4),
    }),
    buildPlaylistItem,
    playedClockRef: playedClockRef as never,
    trackStartedAtRef,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    setTrackInstanceId: vi.fn(),
  });

  return { playlist, currentIndex, isPlaying, isPaused, elapsedMs, settled, autoAdvanceGuardRef, trackInstanceIdRef };
};

const storePlayingSession = (playlistStorageKey: string, overrides: Partial<StoredPlaybackSession>) => {
  localStorage.setItem(
    playlistStorageKey,
    JSON.stringify({
      items: [
        {
          source: "hvsc",
          path: ITEM_PATH,
          name: "tune.sid",
          sourceId: "hvsc-library",
          addedAt: new Date().toISOString(),
          durationMs: 30_000,
        },
      ],
      currentIndex: 0,
    }),
  );
  // Overdue by 12 s, as on the rig: a guard armed from this fires the moment the page opens.
  writeStoredPlaybackSession({
    playlistKey: playlistStorageKey,
    currentItemId: ITEM_ID,
    currentItemLabel: "tune.sid",
    currentIndex: 0,
    isPlaying: true,
    isPaused: false,
    elapsedMs: 20_000,
    playedMs: 20_000,
    durationMs: 30_000,
    autoAdvanceDueAtMs: Date.now() - 12_000,
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });
};

describe("usePlaybackPersistence after a device switch made away from Play", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetPlaylistDataRepositoryForTests();
    rig.selectedDeviceId = "device-b";
    rig.phonePlaying = false;
  });

  it("restores a session that was playing on another device as stopped, keeping the tune and arming no auto-advance", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    storePlayingSession(playlistStorageKey, { playbackDeviceId: "device-a" });

    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.playlist.map((item) => item.id)).toEqual([ITEM_ID]);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(result.current.trackInstanceIdRef.current).toBe(0);
  });

  it("restores a session that was playing on the selected device as playing, with its overdue auto-advance armed", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    storePlayingSession(playlistStorageKey, { playbackDeviceId: "device-b" });

    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current?.dueAtMs).toBeLessThan(Date.now());
  });

  it("restores a session stored before the device was recorded as playing, as it always did", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    storePlayingSession(playlistStorageKey, {});

    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.autoAdvanceGuardRef.current).not.toBeNull();
  });

  it("keeps a tune still playing on the phone playing although another device is selected now", async () => {
    rig.phonePlaying = true;
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    storePlayingSession(playlistStorageKey, { playbackDeviceId: "device-a", playingOnPhone: true });

    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.isPaused).toBe(false);
  });

  it("records the selected device in the stored session while playing", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    storePlayingSession(playlistStorageKey, { playbackDeviceId: "device-b" });

    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => expect(result.current.settled).toBe(true));
    await waitFor(() =>
      expect(readStoredPlaybackSession()).toMatchObject({ playbackDeviceId: "device-b", isPlaying: true }),
    );
  });
});

describe("isStoredSessionFromAnotherDevice", () => {
  const session = { isPlaying: true, isPaused: false, playingOnPhone: false, playbackDeviceId: "device-a" };

  it("is true for a C64 session, playing or paused, stored while another device was selected", () => {
    expect(isStoredSessionFromAnotherDevice(session, "device-b")).toBe(true);
    expect(isStoredSessionFromAnotherDevice({ ...session, isPlaying: true, isPaused: true }, "device-b")).toBe(true);
  });

  it("is false for the selected device, a phone session, a stopped session, or one with no recorded device", () => {
    expect(isStoredSessionFromAnotherDevice(session, "device-a")).toBe(false);
    expect(isStoredSessionFromAnotherDevice({ ...session, playingOnPhone: true }, "device-b")).toBe(false);
    expect(isStoredSessionFromAnotherDevice({ ...session, isPlaying: false }, "device-b")).toBe(false);
    expect(isStoredSessionFromAnotherDevice({ ...session, playbackDeviceId: undefined }, "device-b")).toBe(false);
  });
});
