/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerListRowScroller } from "@/components/lists/listRowReveal";
import { usePlaylistQueueActions } from "@/pages/playFiles/hooks/usePlaylistQueueActions";
import { CATEGORY_OPTIONS } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

const ring = vi.hoisted(() => ({
  focusRingElement: vi.fn(),
  revealRingElementAfterLayout: vi.fn(() => () => {}),
}));
const modality = vi.hoisted(() => ({ current: "key-navigation" }));

vi.mock("@/lib/input/ringDom", () => ring);
vi.mock("@/lib/input/inputModality", () => ({ getInputModality: () => modality.current }));

const buildItem = (name: string): PlaylistItem => ({
  id: `local:/Music/${name}.sid`,
  request: { source: "local", path: `/Music/${name}.sid` },
  category: "sid",
  label: `${name}.sid`,
  path: `/Music/${name}.sid`,
  addedAt: "2026-02-12T00:00:00.000Z",
  status: "ready",
  unavailableReason: null,
});

const playlist = ["a", "b", "c", "d"].map(buildItem);
const idsOf = (items: PlaylistItem[]) => items.map((item) => item.label.replace(".sid", ""));

type Overrides = {
  currentIndex?: number;
  currentPlayingItemId?: string | null;
  shuffleEnabled?: boolean;
  playlistTypeFilters?: PlaylistItem["category"][];
  filterText?: string;
};

const setup = ({
  currentIndex = -1,
  currentPlayingItemId = null,
  shuffleEnabled = false,
  playlistTypeFilters = CATEGORY_OPTIONS,
  filterText = "",
}: Overrides = {}) => {
  const setPlaylist = vi.fn();
  const setCurrentIndex = vi.fn();
  const removeItems = vi.fn();
  const hook = renderHook(() =>
    usePlaylistQueueActions(
      { playlist, setPlaylist, currentIndex, setCurrentIndex, shuffleEnabled, playlistTypeFilters },
      filterText,
      currentPlayingItemId,
      removeItems,
    ),
  );
  return { hook, setPlaylist, setCurrentIndex, removeItems };
};

beforeEach(() => {
  ring.focusRingElement.mockClear();
  ring.revealRingElementAfterLayout.mockClear();
  modality.current = "key-navigation";
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("usePlaylistQueueActions", () => {
  it("moves a row down and keeps the current index on the playing row", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 1, currentPlayingItemId: playlist[1].id });

    act(() => hook.result.current.moveDown(playlist[1].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["a", "c", "b", "d"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(2);
  });

  it("moves a row up across the playing row and shifts the current index with it", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 1, currentPlayingItemId: playlist[1].id });

    act(() => hook.result.current.moveUp(playlist[2].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["a", "c", "b", "d"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(2);
  });

  it("moves a row directly after the playing row", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 0, currentPlayingItemId: playlist[0].id });

    act(() => hook.result.current.playNext(playlist[3].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["a", "d", "b", "c"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(0);
  });

  it("moves a row to the top when nothing plays, and keeps the stopped selection on its tune", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 2, currentPlayingItemId: null });

    act(() => hook.result.current.playNext(playlist[3].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["d", "a", "b", "c"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(3);
  });

  it("moves the playing row to the top and keeps the current index on it", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 2, currentPlayingItemId: playlist[2].id });

    act(() => hook.result.current.moveToTop(playlist[2].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["c", "a", "b", "d"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(0);
  });

  it("moves a row to the bottom and shifts the current index of the playing row above it", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 2, currentPlayingItemId: playlist[2].id });

    act(() => hook.result.current.moveToBottom(playlist[0].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["b", "c", "d", "a"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(1);
  });

  it("moves the playing row to the bottom and keeps the current index on it", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 0, currentPlayingItemId: playlist[0].id });

    act(() => hook.result.current.moveToBottom(playlist[0].id));

    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["b", "c", "d", "a"]);
    expect(setCurrentIndex).toHaveBeenCalledWith(3);
  });

  it("changes no state for Move to top on the first row or Move to bottom on the last row", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 0 });

    act(() => {
      hook.result.current.moveToTop(playlist[0].id);
      hook.result.current.moveToBottom(playlist[3].id);
    });

    expect(setPlaylist).not.toHaveBeenCalled();
    expect(setCurrentIndex).not.toHaveBeenCalled();
  });

  it("does not move to an edge while Shuffle is on or a filter hides rows", () => {
    const shuffled = setup({ shuffleEnabled: true });
    const filtered = setup({ filterText: "a" });

    act(() => {
      shuffled.hook.result.current.moveToTop(playlist[2].id);
      filtered.hook.result.current.moveToBottom(playlist[1].id);
    });

    expect(shuffled.setPlaylist).not.toHaveBeenCalled();
    expect(filtered.setPlaylist).not.toHaveBeenCalled();
  });

  it("removes one row by id, also while Shuffle is on and while a filter hides rows", () => {
    const shuffled = setup({ shuffleEnabled: true });
    const filtered = setup({ filterText: "a" });

    act(() => {
      shuffled.hook.result.current.remove(playlist[1].id);
      filtered.hook.result.current.remove(playlist[2].id);
    });

    expect(shuffled.removeItems).toHaveBeenCalledWith(new Set([playlist[1].id]));
    expect(filtered.removeItems).toHaveBeenCalledWith(new Set([playlist[2].id]));
  });

  it("changes no state for a move that changes nothing", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ currentIndex: 0, currentPlayingItemId: playlist[0].id });

    act(() => {
      hook.result.current.moveUp(playlist[0].id);
      hook.result.current.playNext(playlist[1].id);
    });

    expect(setPlaylist).not.toHaveBeenCalled();
    expect(setCurrentIndex).not.toHaveBeenCalled();
  });

  it("changes no state while Shuffle is on", () => {
    const { hook, setPlaylist } = setup({ shuffleEnabled: true });

    act(() => hook.result.current.moveDown(playlist[1].id));

    expect(setPlaylist).not.toHaveBeenCalled();
  });

  it("does not play next while Shuffle is on, because a move would reshuffle the tunes still to come", () => {
    const { hook, setPlaylist, setCurrentIndex } = setup({ shuffleEnabled: true, currentIndex: 0 });

    act(() => hook.result.current.playNext(playlist[3].id));

    expect(setPlaylist).not.toHaveBeenCalled();
    expect(setCurrentIndex).not.toHaveBeenCalled();
  });

  it("changes no order while a filter hides rows, but still plays next", () => {
    const { hook, setPlaylist } = setup({ filterText: "b" });

    act(() => hook.result.current.moveDown(playlist[1].id));
    expect(setPlaylist).not.toHaveBeenCalled();

    act(() => hook.result.current.playNext(playlist[1].id));
    expect(idsOf(setPlaylist.mock.calls[0][0])).toEqual(["b", "a", "c", "d"]);
  });

  it("reports a text filter and a type filter as hiding rows, and blank text as not", () => {
    expect(setup({ filterText: " " }).hook.result.current.filterHidesRows).toBe(false);
    expect(setup({ filterText: "b" }).hook.result.current.filterHidesRows).toBe(true);
    expect(setup({ playlistTypeFilters: ["sid"] }).hook.result.current.filterHidesRows).toBe(true);
    expect(setup().hook.result.current.shuffleEnabled).toBe(false);
  });

  it("keeps the same handler identities across renders so the row cache is not rebuilt", () => {
    const { hook } = setup();
    const first = hook.result.current;

    hook.rerender();

    expect(hook.result.current).toBe(first);
  });

  it("puts the keypad ring back on the moved row's menu button after the playlist changes", async () => {
    document.body.innerHTML = `<div data-row-id="${playlist[1].id}"><button aria-label="Item actions"></button></div>`;
    const button = document.querySelector("button")!;
    const setPlaylist = vi.fn();
    const hook = renderHook(
      ({ list }: { list: PlaylistItem[] }) =>
        usePlaylistQueueActions(
          {
            playlist: list,
            setPlaylist,
            currentIndex: -1,
            setCurrentIndex: vi.fn(),
            shuffleEnabled: false,
            playlistTypeFilters: CATEGORY_OPTIONS,
          },
          "",
          null,
        ),
      { initialProps: { list: playlist } },
    );

    act(() => hook.result.current.moveDown(playlist[1].id));
    expect(ring.focusRingElement).not.toHaveBeenCalled();

    hook.rerender({ list: setPlaylist.mock.calls[0][0] });
    await act(async () => {});

    expect(ring.focusRingElement).toHaveBeenCalledWith(button);
    expect(ring.revealRingElementAfterLayout).toHaveBeenCalledWith(button);
  });

  it("leaves focus alone for a touch user", async () => {
    modality.current = "pointer";
    document.body.innerHTML = `<div data-row-id="${playlist[1].id}"><button aria-label="Item actions"></button></div>`;
    const setPlaylist = vi.fn();
    const hook = renderHook(
      ({ list }: { list: PlaylistItem[] }) =>
        usePlaylistQueueActions(
          {
            playlist: list,
            setPlaylist,
            currentIndex: -1,
            setCurrentIndex: vi.fn(),
            shuffleEnabled: false,
            playlistTypeFilters: CATEGORY_OPTIONS,
          },
          "",
          null,
        ),
      { initialProps: { list: playlist } },
    );

    act(() => hook.result.current.moveDown(playlist[1].id));
    hook.rerender({ list: setPlaylist.mock.calls[0][0] });
    await act(async () => {});

    expect(ring.focusRingElement).not.toHaveBeenCalled();
  });

  it("asks a virtualized list to render a row moved out of its range, then focuses it", async () => {
    const scroller = vi.fn((rowId: string) => {
      document.body.innerHTML = `<div data-row-id="${rowId}"><button aria-label="Item actions"></button></div>`;
      return true;
    });
    const unregister = registerListRowScroller(scroller);
    document.body.innerHTML = "";
    const setPlaylist = vi.fn();
    const hook = renderHook(
      ({ list }: { list: PlaylistItem[] }) =>
        usePlaylistQueueActions(
          {
            playlist: list,
            setPlaylist,
            currentIndex: 0,
            setCurrentIndex: vi.fn(),
            shuffleEnabled: false,
            playlistTypeFilters: CATEGORY_OPTIONS,
          },
          "",
          playlist[0].id,
        ),
      { initialProps: { list: playlist } },
    );

    act(() => hook.result.current.playNext(playlist[3].id));
    hook.rerender({ list: setPlaylist.mock.calls[0][0] });
    await vi.waitFor(() => expect(ring.focusRingElement).toHaveBeenCalled());

    expect(scroller).toHaveBeenCalledWith(playlist[3].id);
    expect(ring.focusRingElement).toHaveBeenCalledWith(document.querySelector("button"));
    unregister();
  });

  const renderWithRerender = (setPlaylist: ReturnType<typeof vi.fn>) =>
    renderHook(
      ({ list }: { list: PlaylistItem[] }) =>
        usePlaylistQueueActions(
          {
            playlist: list,
            setPlaylist,
            currentIndex: -1,
            setCurrentIndex: vi.fn(),
            shuffleEnabled: false,
            playlistTypeFilters: CATEGORY_OPTIONS,
          },
          "",
          null,
        ),
      { initialProps: { list: playlist } },
    );

  it("leaves focus alone when no list renders the moved row", async () => {
    document.body.innerHTML = "";
    const setPlaylist = vi.fn();
    const hook = renderWithRerender(setPlaylist);

    act(() => hook.result.current.moveDown(playlist[1].id));
    hook.rerender({ list: setPlaylist.mock.calls[0][0] });
    await act(async () => {});

    expect(ring.focusRingElement).not.toHaveBeenCalled();
    expect(ring.revealRingElementAfterLayout).not.toHaveBeenCalled();
  });

  it("does not focus a row that only appears after the page that moved it has gone", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = "";
      const unregister = registerListRowScroller(() => true);
      const setPlaylist = vi.fn();
      const hook = renderWithRerender(setPlaylist);

      act(() => hook.result.current.moveDown(playlist[1].id));
      hook.rerender({ list: setPlaylist.mock.calls[0][0] });
      hook.unmount();
      document.body.innerHTML = `<div data-row-id="${playlist[1].id}"><button aria-label="Item actions"></button></div>`;
      await vi.advanceTimersByTimeAsync(200);

      expect(ring.focusRingElement).not.toHaveBeenCalled();
      unregister();
    } finally {
      vi.useRealTimers();
    }
  });
});
