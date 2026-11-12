/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearToastStateForTests } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { resolvePlayOrderIndices } from "@/pages/playFiles/playFilesUtils";
import { usePlaylistRemoval } from "@/pages/playFiles/hooks/usePlaylistRemoval";
import type { PlaylistItem } from "@/pages/playFiles/types";

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

const names = (items: PlaylistItem[]) => items.map((item) => item.label.replace(".sid", ""));
const idOf = (name: string) => buildItem(name).id;

type Setup = { playing?: boolean; currentIndex?: number };

const setup = ({ playing = false, currentIndex = -1 }: Setup = {}) => {
  const stopPlayback = vi.fn();
  const startedPlayback = vi.fn();
  const hook = renderHook(() => {
    const [playlist, setPlaylist] = useState(["a", "b", "c", "d"].map(buildItem));
    const [current, setCurrent] = useState(currentIndex);
    const [selected, setSelected] = useState(new Set<string>());
    const removal = usePlaylistRemoval({
      playlist,
      currentIndex: current,
      isPlaying: playing,
      isPaused: false,
      stopPlayback,
      setPlaylist,
      setCurrentIndex: setCurrent,
      setSelectedPlaylistIds: setSelected,
    });
    return { ...removal, playlist, setPlaylist, current, selected, setSelected };
  });
  render(<Toaster />);
  return { hook, stopPlayback, startedPlayback };
};

const undo = () => act(() => screen.getByRole("button", { name: "Undo" }).click());

describe("usePlaylistRemoval", () => {
  beforeEach(() => {
    __clearToastStateForTests();
  });

  it("removes a row, announces it with Undo, and Undo puts it back at its position", () => {
    const { hook } = setup();

    act(() => hook.result.current.removeWithUndo(new Set([idOf("b")])));

    expect(names(hook.result.current.playlist)).toEqual(["a", "c", "d"]);
    expect(screen.getByText("Removed 1 item")).toBeInTheDocument();

    undo();

    expect(names(hook.result.current.playlist)).toEqual(["a", "b", "c", "d"]);
  });

  it("restores several rows removed in one go to their original positions", () => {
    const { hook } = setup();

    act(() => hook.result.current.removeWithUndo(new Set([idOf("a"), idOf("c")])));
    expect(screen.getByText("Removed 2 items")).toBeInTheDocument();
    undo();

    expect(names(hook.result.current.playlist)).toEqual(["a", "b", "c", "d"]);
  });

  it("stops playback when the playing row is removed, and Undo restores the row without resuming", () => {
    const { hook, stopPlayback } = setup({ playing: true, currentIndex: 1 });

    act(() => hook.result.current.removeWithUndo(new Set([idOf("b")])));

    expect(stopPlayback).toHaveBeenCalledTimes(1);
    expect(hook.result.current.current).toBe(-1);

    undo();

    expect(names(hook.result.current.playlist)).toEqual(["a", "b", "c", "d"]);
    expect(hook.result.current.current).toBe(-1);
    expect(stopPlayback).toHaveBeenCalledTimes(1);
  });

  it("keeps the playing row current when rows above it are removed and restored", () => {
    const { hook, stopPlayback } = setup({ playing: true, currentIndex: 2 });

    act(() => hook.result.current.removeWithUndo(new Set([idOf("a")])));
    expect(hook.result.current.current).toBe(1);
    undo();

    expect(hook.result.current.current).toBe(2);
    expect(stopPlayback).not.toHaveBeenCalled();
  });

  it("removes the last remaining row and restores it", () => {
    const { hook } = setup();
    act(() => hook.result.current.setPlaylist([buildItem("only")]));

    act(() => hook.result.current.removeWithUndo(new Set([idOf("only")])));
    expect(hook.result.current.playlist).toEqual([]);
    undo();

    expect(names(hook.result.current.playlist)).toEqual(["only"]);
  });

  it("keeps a row added after the removal when Undo restores the removed one", () => {
    const { hook } = setup();

    act(() => hook.result.current.removeWithUndo(new Set([idOf("d")])));
    act(() => hook.result.current.setPlaylist((previous) => [...previous, buildItem("x")]));
    undo();

    expect(names(hook.result.current.playlist)).toEqual(["a", "b", "c", "d", "x"]);
  });

  it("drops the removed rows from the selection and does not select them again on Undo", () => {
    const { hook } = setup();
    act(() => hook.result.current.setSelected(new Set([idOf("a"), idOf("b")])));

    act(() => hook.result.current.removeWithUndo(new Set([idOf("a")])));
    expect([...hook.result.current.selected]).toEqual([idOf("b")]);
    undo();

    expect([...hook.result.current.selected]).toEqual([idOf("b")]);
  });

  it("neither removes nor announces anything for an id the playlist does not hold", () => {
    const { hook } = setup();

    act(() => hook.result.current.removeWithUndo(new Set(["missing"])));

    expect(names(hook.result.current.playlist)).toEqual(["a", "b", "c", "d"]);
    expect(screen.queryByText(/Removed/)).not.toBeInTheDocument();
  });

  it("removes silently, with no Undo, through the plain remover used for demo cleanup", () => {
    const { hook } = setup();

    act(() => hook.result.current.removePlaylistItemsById(new Set([idOf("c")])));

    expect(names(hook.result.current.playlist)).toEqual(["a", "b", "d"]);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  describe("with Shuffle on", () => {
    const SEED = 12345;
    const playOrder = (playlist: PlaylistItem[], anchorId: string | null) =>
      resolvePlayOrderIndices(playlist, true, SEED, anchorId);

    it("restores the same array, so the shuffled order and the next track are what they were", () => {
      const { hook } = setup({ playing: true, currentIndex: 2 });
      const original = hook.result.current.playlist;
      const orderBefore = playOrder(original, idOf("c"));

      act(() => hook.result.current.removeWithUndo(new Set([idOf("a"), idOf("d")])));
      const orderWhileRemoved = playOrder(hook.result.current.playlist, idOf("c"));
      expect([...orderWhileRemoved].sort()).toEqual([0, 1]);
      undo();

      expect(hook.result.current.playlist).toEqual(original);
      expect(hook.result.current.current).toBe(2);
      expect(playOrder(hook.result.current.playlist, idOf("c"))).toEqual(orderBefore);
    });

    it("restores the playing row without making it current again, leaving the shuffled order as it was", () => {
      const { hook, stopPlayback } = setup({ playing: true, currentIndex: 1 });
      const original = hook.result.current.playlist;
      const orderBefore = playOrder(original, idOf("b"));

      act(() => hook.result.current.removeWithUndo(new Set([idOf("b")])));
      expect(stopPlayback).toHaveBeenCalledTimes(1);
      undo();

      expect(hook.result.current.playlist).toEqual(original);
      expect(hook.result.current.current).toBe(-1);
      expect(playOrder(hook.result.current.playlist, idOf("b"))).toEqual(orderBefore);
      expect(stopPlayback).toHaveBeenCalledTimes(1);
    });
  });
});
