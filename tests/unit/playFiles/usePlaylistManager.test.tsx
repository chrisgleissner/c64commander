/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaylistManager } from "@/pages/playFiles/hooks/usePlaylistManager";
import type { PlaylistItem } from "@/pages/playFiles/types";

const createPlaylistItem = (id: string): PlaylistItem => ({
  id,
  request: {
    source: "ultimate",
    path: `/PROGRAMS/${id}.prg`,
  },
  category: "prg",
  label: `${id}.prg`,
  path: `/PROGRAMS/${id}.prg`,
  durationMs: undefined,
  sourceId: null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
});

describe("usePlaylistManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prunes selection state when playlist entries are removed", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setSelectedPlaylistIds(new Set(["a", "c"]));
    });

    act(() => {
      result.current.setPlaylist([items[1]]);
    });

    expect(Array.from(result.current.selectedPlaylistIds)).toEqual([]);
  });

  it("preserves the current selection set when every selected id still exists", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setSelectedPlaylistIds(new Set(["a", "c"]));
    });

    const selectedBefore = result.current.selectedPlaylistIds;

    act(() => {
      result.current.setPlaylist([items[2], items[1], items[0]]);
    });

    expect(result.current.selectedPlaylistIds).toBe(selectedBefore);
  });

  it("does not generate a shuffle seed while shuffle stays disabled", () => {
    const { result } = renderHook(() => usePlaylistManager());

    expect(result.current.shuffleSeed).toBeNull();
  });

  it("lazily generates a shuffle seed the first time shuffle is enabled, without touching the playlist", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setShuffleEnabled(true);
    });

    expect(result.current.shuffleSeed).not.toBeNull();
    expect(result.current.playlist).toEqual(items);
  });

  it("keeps handleReshuffle as a no-op when shuffle is disabled", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b")];
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setCurrentIndex(0);
    });

    act(() => {
      result.current.handleReshuffle();
    });

    expect(result.current.playlist).toEqual(items);
    expect(result.current.reshuffleActive).toBe(false);
  });

  it("keeps handleReshuffle as a no-op when the playlist is empty", () => {
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setShuffleEnabled(true);
      result.current.handleReshuffle();
    });

    expect(result.current.playlist).toEqual([]);
    expect(result.current.reshuffleActive).toBe(false);
  });

  it("reshuffle activates reshuffle state and generates a new seed without reordering the curated playlist (HARD9-007)", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setCurrentIndex(1);
      result.current.setShuffleEnabled(true);
    });

    const seedAfterEnable = result.current.shuffleSeed;

    act(() => {
      result.current.handleReshuffle();
    });

    expect(result.current.reshuffleActive).toBe(true);
    // The curated playlist array is never reordered - only the shuffle seed changes.
    expect(result.current.playlist).toBe(items);
    expect(result.current.shuffleSeed).not.toBe(seedAfterEnable);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.reshuffleActive).toBe(false);
  });

  it("clears the in-flight reshuffle timer before starting a new one", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setCurrentIndex(1);
      result.current.setShuffleEnabled(true);
    });

    act(() => {
      result.current.handleReshuffle();
      result.current.handleReshuffle();
    });

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(result.current.reshuffleActive).toBe(true);
  });

  it("clears an in-flight reshuffle timer when the hook unmounts", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const { result, unmount } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setCurrentIndex(1);
      result.current.setShuffleEnabled(true);
    });

    act(() => {
      result.current.handleReshuffle();
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(200);
    });
  });
});
