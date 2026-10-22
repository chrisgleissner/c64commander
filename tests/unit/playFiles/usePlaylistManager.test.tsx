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
  it("remembers repeat-one across Play page remounts and lets the listener turn it off", () => {
    const first = renderHook(() => usePlaylistManager());
    expect(first.result.current.repeatOneEnabled).toBe(false);
    act(() => first.result.current.setRepeatOneEnabled(true));
    first.unmount();
    const next = renderHook(() => usePlaylistManager());
    expect(next.result.current.repeatOneEnabled).toBe(true);
    act(() => next.result.current.setRepeatOneEnabled(false));
    expect(next.result.current.repeatOneEnabled).toBe(false);
    expect(localStorage.getItem("c64u_repeat_one_enabled")).toBe("0");
  });

  beforeEach(() => {
    localStorage.clear();
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

  it("anchors a queue added after Shuffle was enabled and repairs a legacy missing seed", () => {
    const { result } = renderHook(() => usePlaylistManager());
    act(() => result.current.setShuffleEnabled(true));
    act(() => {
      result.current.setPlaylist([createPlaylistItem("a"), createPlaylistItem("b")]);
      result.current.setShuffleSeed(null);
    });
    expect(result.current.shuffleSeed).not.toBeNull();
    expect(result.current.shuffleAnchorId).toBe("a");
  });

  it("anchors the first item when the current index points past the end of the queue", () => {
    const { result } = renderHook(() => usePlaylistManager());
    act(() => result.current.setShuffleEnabled(true));
    act(() => {
      result.current.setCurrentIndex(9);
      result.current.setPlaylist([createPlaylistItem("a"), createPlaylistItem("b")]);
    });
    expect(result.current.shuffleAnchorId).toBe("a");
  });

  it("creates a fresh upcoming shuffle order on off/on without changing the current item or curated queue", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.7);
    const items = [createPlaylistItem("a"), createPlaylistItem("b"), createPlaylistItem("c")];
    const { result } = renderHook(() => usePlaylistManager());
    act(() => {
      result.current.setPlaylist(items);
      result.current.setCurrentIndex(1);
      result.current.setShuffleEnabled(true);
    });
    const firstSeed = result.current.shuffleSeed;
    act(() => result.current.setShuffleEnabled(false));
    act(() => result.current.setShuffleEnabled(true));
    expect(result.current.shuffleSeed).not.toBe(firstSeed);
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.shuffleAnchorId).toBe("b");
    expect(result.current.playlist).toBe(items);
  });
});
