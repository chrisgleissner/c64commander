/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ playlists: new Map<string, unknown[]>(), toast: vi.fn() }));

vi.mock("@/pages/playFiles/playlistRepositorySync", () => ({
  commitPlaylistSnapshot: vi.fn(async ({ playlistId, items }: { playlistId: string; items: unknown[] }) => {
    repo.playlists.set(playlistId, [...items]);
    return { committedCount: items.length, expectedCount: items.length, revision: 1, snapshotKey: "k" };
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: repo.toast }));

import { mergeStartedPlaylist } from "@/pages/playFiles/startPlaylistMerge";
import {
  rememberHandover,
  rememberedHandover,
  SAVED_PLAYLIST_READ,
  writeHandoverRecord,
} from "@/pages/playFiles/stationPlaylistHandover";
import {
  PLAYLIST_RESTORED_TOAST,
  SAVED_PLAYLIST_LOST_TOAST,
  useStationPlaylistHandover,
} from "@/pages/playFiles/hooks/useStationPlaylistHandover";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (id: string) => ({ id, path: `/${id}.sid`, category: "sid" }) as unknown as PlaylistItem;
const ids = (items: readonly PlaylistItem[]) => items.map((entry) => entry.id);

const mine = [item("a"), item("b"), item("c")];
const stationA = [item("radio:1"), item("radio:2"), item("radio:3")];
const stationB = [item("radio:7"), item("radio:8")];

type HarnessProps = {
  stationActive: boolean;
  isPlaying: boolean;
  isPaused?: boolean;
  playlistEnded?: boolean;
  initialPlaylist?: PlaylistItem[];
  initialIndex?: number;
  resumeSettled?: boolean;
  readSavedPlaylist?: (playlistId: string) => Promise<PlaylistItem[]>;
};

const stationStop = vi.fn();
const stopPlayback = vi.fn();

const useHarness = (props: HarnessProps) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(props.initialPlaylist ?? mine);
  const [currentIndex, setCurrentIndex] = useState(props.initialIndex ?? 1);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState(new Set(["c"]));
  const stationActiveRef = useRef(false);
  const startPlaylist = async (items: PlaylistItem[], startIndex: number, options: { replaceQueue: boolean }) => {
    setPlaylist((prev) => mergeStartedPlaylist(prev, items, options));
    setCurrentIndex(startIndex);
    return true;
  };
  const handover = useStationPlaylistHandover({
    queue: { playlist, setPlaylist, currentIndex, setCurrentIndex, selectedPlaylistIds, setSelectedPlaylistIds },
    playback: {
      isPlaying: props.isPlaying,
      isPaused: props.isPaused ?? false,
      playlistEnded: props.playlistEnded ?? false,
      startPlaylist,
      stopPlayback,
      stationActiveRef,
    },
    persistence: {
      ready: true,
      readSavedPlaylist:
        props.readSavedPlaylist ?? (async (playlistId) => (repo.playlists.get(playlistId) ?? []) as PlaylistItem[]),
    },
    station: { active: props.stationActive, resumeSettled: props.resumeSettled ?? true, stop: stationStop },
  });
  return { playlist, currentIndex, selectedPlaylistIds, stationActiveRef, handover, setPlaylist, setCurrentIndex };
};

const renderHarness = (props: HarnessProps) =>
  renderHook((current: HarnessProps) => useHarness(current), { initialProps: props });

/** Starts a station the way SID Radio does: it claims the station, then hands over its queue. */
const startStation = async (harness: ReturnType<typeof renderHarness>, items: PlaylistItem[], playing = true) => {
  harness.rerender({ stationActive: true, isPlaying: playing });
  await act(async () => {
    await harness.result.current.handover.startStationQueue(items);
  });
};

beforeEach(() => {
  localStorage.clear();
  rememberHandover(null);
  repo.playlists.clear();
  repo.toast.mockClear();
  stationStop.mockClear();
  stopPlayback.mockClear();
});

describe("useStationPlaylistHandover", () => {
  it("lets the station's current tune finish, then brings the listener's playlist back", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: true });
    await startStation(harness, stationA);
    expect(ids(harness.result.current.playlist)).toEqual(["radio:1", "radio:2", "radio:3"]);
    act(() => harness.result.current.setCurrentIndex(1));

    harness.rerender({ stationActive: false, isPlaying: true });

    expect(ids(harness.result.current.playlist)).toEqual(["radio:2"]);
    expect(harness.result.current.currentIndex).toBe(0);
    expect(stopPlayback).not.toHaveBeenCalled();
    expect(harness.result.current.stationActiveRef.current).toBe(true);

    harness.rerender({ stationActive: false, isPlaying: true, playlistEnded: true });

    expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "c"]);
    expect(harness.result.current.currentIndex).toBe(1);
    expect([...harness.result.current.selectedPlaylistIds]).toEqual(["c"]);
    expect(stopPlayback).toHaveBeenCalledTimes(1);
    expect(repo.toast).toHaveBeenLastCalledWith({ title: PLAYLIST_RESTORED_TOAST });
    expect(harness.result.current.stationActiveRef.current).toBe(false);
  });

  it("keeps the station's last tune through a pause, and brings the playlist back on Stop", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: true });
    await startStation(harness, stationA);
    act(() => harness.result.current.setCurrentIndex(1));
    harness.rerender({ stationActive: false, isPlaying: true });

    harness.rerender({ stationActive: false, isPlaying: true, isPaused: true });
    expect(ids(harness.result.current.playlist)).toEqual(["radio:2"]);
    harness.rerender({ stationActive: false, isPlaying: true, isPaused: false });
    expect(ids(harness.result.current.playlist)).toEqual(["radio:2"]);
    expect(stopPlayback).not.toHaveBeenCalled();

    harness.rerender({ stationActive: false, isPlaying: false });
    expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "c"]);
  });

  it("brings the playlist back at once when the station's last tune comes back paused after a relaunch", async () => {
    const before = renderHarness({ stationActive: false, isPlaying: true });
    await startStation(before, stationA);
    act(() => before.result.current.setCurrentIndex(1));
    before.rerender({ stationActive: false, isPlaying: true });
    before.unmount();
    rememberHandover(null);

    const after = renderHarness({
      stationActive: false,
      isPlaying: true,
      isPaused: true,
      initialPlaylist: [item("radio:2")],
      initialIndex: 0,
    });

    await waitFor(() => expect(ids(after.result.current.playlist)).toEqual(["a", "b", "c"]));
  });

  it("brings the playlist back at once when the station stops while nothing plays", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(harness, stationA, false);

    harness.rerender({ stationActive: false, isPlaying: false });

    expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "c"]);
    expect(stopPlayback).not.toHaveBeenCalled();
  });

  it("does not let a second station overwrite the saved playlist with the first station's queue", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(harness, stationA, false);
    await startStation(harness, stationB, false);
    expect(ids(harness.result.current.playlist)).toEqual(["radio:7", "radio:8"]);

    harness.rerender({ stationActive: false, isPlaying: false });

    expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "c"]);
  });

  it("restores the saved playlist after an app restart while the station ran", async () => {
    const before = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(before, stationA, false);
    before.unmount();
    rememberHandover(null);

    const after = renderHarness({
      stationActive: false,
      isPlaying: false,
      initialPlaylist: stationA,
      initialIndex: 0,
      resumeSettled: false,
    });
    after.rerender({ stationActive: true, isPlaying: false });
    await act(async () => {
      await Promise.resolve();
    });
    after.rerender({ stationActive: false, isPlaying: false });

    await waitFor(() => expect(ids(after.result.current.playlist)).toEqual(["a", "b", "c"]));
    expect(after.result.current.currentIndex).toBe(1);
  });

  it("brings the playlist back on returning to Play when the station did not resume, as after turning SID Radio off", async () => {
    const before = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(before, stationA, false);
    before.unmount();
    stationStop.mockClear();

    const after = renderHarness({ stationActive: false, isPlaying: false, initialPlaylist: stationA, initialIndex: 0 });

    await waitFor(() => expect(ids(after.result.current.playlist)).toEqual(["a", "b", "c"]));
    expect(stationStop).toHaveBeenCalledTimes(1);
  });

  it("lets the tune still playing finish when Play comes back to a station that did not resume", async () => {
    const before = renderHarness({ stationActive: false, isPlaying: true });
    await startStation(before, stationA);
    before.unmount();

    const after = renderHarness({ stationActive: false, isPlaying: true, initialPlaylist: stationA, initialIndex: 1 });

    expect(ids(after.result.current.playlist)).toEqual(["radio:2"]);
    expect(after.result.current.stationActiveRef.current).toBe(true);
    after.rerender({ stationActive: false, isPlaying: false });
    expect(ids(after.result.current.playlist)).toEqual(["a", "b", "c"]);
  });

  it("waits for SID Radio to resume the station before deciding it is over", async () => {
    const before = renderHarness({ stationActive: false, isPlaying: true });
    await startStation(before, stationA);
    before.unmount();

    const after = renderHarness({
      stationActive: false,
      isPlaying: true,
      initialPlaylist: stationA,
      initialIndex: 1,
      resumeSettled: false,
    });
    after.rerender({ stationActive: true, isPlaying: true });

    expect(ids(after.result.current.playlist)).toEqual(["radio:1", "radio:2", "radio:3"]);
  });

  describe("when the saved playlist cannot be read back after a restart", () => {
    const relaunchWhileFinishing = () => {
      writeHandoverRecord({
        items: [],
        currentItemId: "b",
        currentIndex: 1,
        selectedIds: [],
        stationItemIds: ["radio:1"],
        phase: "finishing",
      });
      rememberHandover(null);
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries the read and restores the playlist once it succeeds", async () => {
      vi.useFakeTimers();
      relaunchWhileFinishing();
      const readSavedPlaylist = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(mine);

      const harness = renderHarness({ stationActive: false, isPlaying: false, readSavedPlaylist });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SAVED_PLAYLIST_READ.retryDelayMs);
      });

      expect(readSavedPlaylist).toHaveBeenCalledTimes(2);
      expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "c"]);
    });

    it("gives the handover up after the last attempt, so the station's last tune no longer holds the queue order", async () => {
      vi.useFakeTimers();
      relaunchWhileFinishing();
      const readSavedPlaylist = vi.fn().mockRejectedValue(new Error("unreadable"));

      const harness = renderHarness({ stationActive: false, isPlaying: false, readSavedPlaylist });
      expect(harness.result.current.stationActiveRef.current).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SAVED_PLAYLIST_READ.retryDelayMs * SAVED_PLAYLIST_READ.attempts ** 2);
      });

      expect(readSavedPlaylist).toHaveBeenCalledTimes(SAVED_PLAYLIST_READ.attempts);
      expect(harness.result.current.stationActiveRef.current).toBe(false);
      expect(rememberedHandover()).toBeNull();
      expect(repo.toast).toHaveBeenCalledWith(expect.objectContaining({ title: SAVED_PLAYLIST_LOST_TOAST }));
    });

    it("gives up on a read that never answers", async () => {
      vi.useFakeTimers();
      relaunchWhileFinishing();
      const readSavedPlaylist = vi.fn(() => new Promise<PlaylistItem[]>(() => undefined));

      const harness = renderHarness({ stationActive: false, isPlaying: false, readSavedPlaylist });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          (SAVED_PLAYLIST_READ.timeoutMs + SAVED_PLAYLIST_READ.retryDelayMs * SAVED_PLAYLIST_READ.attempts) *
            SAVED_PLAYLIST_READ.attempts,
        );
      });

      expect(readSavedPlaylist).toHaveBeenCalledTimes(SAVED_PLAYLIST_READ.attempts);
      expect(harness.result.current.stationActiveRef.current).toBe(false);
    });
  });

  it("asks before stopping a station whose queue the listener edited", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(harness, stationA, false);

    act(() => harness.result.current.handover.requestStop());
    expect(harness.result.current.handover.editedPrompt.open).toBe(false);
    expect(stationStop).toHaveBeenCalledTimes(1);

    stationStop.mockClear();
    act(() => harness.result.current.setPlaylist((prev) => [...prev, item("added")]));
    act(() => harness.result.current.handover.requestStop());

    expect(harness.result.current.handover.editedPrompt.open).toBe(true);
    expect(stationStop).not.toHaveBeenCalled();
  });

  it("keeps the edited station queue when the listener chooses the station's tunes", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(harness, stationA, false);
    act(() => harness.result.current.setPlaylist((prev) => [...prev, item("added")]));
    act(() => harness.result.current.handover.requestStop());

    act(() => harness.result.current.handover.editedPrompt.onKeepStationTunes());
    harness.rerender({ stationActive: false, isPlaying: false });

    expect(stationStop).toHaveBeenCalledTimes(1);
    expect(ids(harness.result.current.playlist)).toEqual(["radio:1", "radio:2", "radio:3", "added"]);
    expect(repo.toast).not.toHaveBeenCalledWith({ title: PLAYLIST_RESTORED_TOAST });
  });

  it("returns to the saved playlist when the listener chooses it over an edited station queue", async () => {
    const harness = renderHarness({ stationActive: false, isPlaying: false });
    await startStation(harness, stationA, false);
    act(() => harness.result.current.setPlaylist((prev) => [...prev, item("added")]));
    act(() => harness.result.current.handover.requestStop());

    act(() => harness.result.current.handover.editedPrompt.onReturnToPlaylist());
    harness.rerender({ stationActive: false, isPlaying: false });

    expect(ids(harness.result.current.playlist)).toEqual(["a", "b", "c"]);
  });
});
