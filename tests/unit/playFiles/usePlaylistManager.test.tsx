/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reshufflePlaylist, usePlaylistManager } from "@/pages/playFiles/hooks/usePlaylistManager";
import * as playFilesUtils from "@/pages/playFiles/playFilesUtils";
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

  it("reshuffles a five-item playlist while keeping the locked item at its index", () => {
    const items = [
      createPlaylistItem("a"),
      createPlaylistItem("b"),
      createPlaylistItem("c"),
      createPlaylistItem("d"),
      createPlaylistItem("e"),
    ];
    vi.spyOn(Math, "random").mockReturnValue(0);

    const reshuffled = reshufflePlaylist(items, 2);

    expect(reshuffled.map((item) => item.id)).not.toEqual(items.map((item) => item.id));
    expect(reshuffled[2]?.id).toBe("c");
  });

  it("guarantees a swap for two unlocked items", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b")];
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(reshufflePlaylist(items, -1).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("keeps the original order when the locked item leaves only one item to reshuffle", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b")];
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(reshufflePlaylist(items, 0).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("swaps reshuffled neighbors when a locked-item shuffle would otherwise keep the same order", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    vi.spyOn(playFilesUtils, "shuffleArray").mockImplementation((value) => [...value]);

    expect(reshufflePlaylist(items, 1).map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("returns the same array when reshuffling a single item", () => {
    const items = [createPlaylistItem("solo")];

    expect(reshufflePlaylist(items, 0)).toBe(items);
  });

  it("reshuffles all items when no locked index is provided", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(reshufflePlaylist(items, -1).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("returns a different unlocked order when shuffleArray already changes the full list", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    vi.spyOn(playFilesUtils, "shuffleArray").mockReturnValue([items[2], items[0], items[1]]);

    expect(reshufflePlaylist(items, -1).map((item) => item.id)).toEqual(["c", "a", "b"]);
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

  it("activates reshuffle state briefly and updates playlist order when shuffle is enabled", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { result } = renderHook(() => usePlaylistManager());

    act(() => {
      result.current.setPlaylist(items);
      result.current.setCurrentIndex(1);
      result.current.setShuffleEnabled(true);
    });

    act(() => {
      result.current.handleReshuffle();
    });

    expect(result.current.reshuffleActive).toBe(true);
    expect(result.current.playlist.map((item) => item.id)).toEqual(["c", "b", "a"]);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.reshuffleActive).toBe(false);
  });

  it("clears the in-flight reshuffle timer before starting a new one", () => {
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    vi.spyOn(Math, "random").mockReturnValue(0);
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
    vi.spyOn(Math, "random").mockReturnValue(0);
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
