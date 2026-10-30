/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useRef } from "react";
import { useLatestCallback } from "@/hooks/useLatestCallback";
import { getInputModality } from "@/lib/input/inputModality";
import { focusRingElement, revealRingElementAfterLayout } from "@/lib/input/ringDom";
import type { usePlaylistManager } from "@/pages/playFiles/hooks/usePlaylistManager";
import { CATEGORY_OPTIONS } from "@/pages/playFiles/playFilesUtils";
import { moveAfterCurrent, moveItem, type ReorderResult } from "@/pages/playFiles/playlistReorder";
import type { PlaylistItem } from "@/pages/playFiles/types";

type PlaylistManagerState = ReturnType<typeof usePlaylistManager>;

export type PlaylistQueueState = Pick<
  PlaylistManagerState,
  "playlist" | "setPlaylist" | "currentIndex" | "setCurrentIndex" | "shuffleEnabled" | "playlistTypeFilters"
>;

export type PlaylistQueueActions = {
  shuffleEnabled: boolean;
  filterHidesRows: boolean;
  playNext: (id: string) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
};

const findMenuButton = (rowId: string): HTMLElement | null => {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]")).filter(
    (row) => row.dataset.rowId === rowId,
  );
  return rows.at(-1)?.querySelector<HTMLElement>('button[aria-label="Item actions"]') ?? null;
};

/**
 * Reorders the playlist from a row's menu. The moved row's menu button keeps the keypad ring and is
 * scrolled into view once the new order is on screen, using the same ring helpers as every other control.
 */
export const usePlaylistQueueActions = (
  { playlist, setPlaylist, currentIndex, setCurrentIndex, shuffleEnabled, playlistTypeFilters }: PlaylistQueueState,
  filterText: string,
  currentPlayingItemId: string | null,
): PlaylistQueueActions => {
  const filterHidesRows = filterText.trim() !== "" || playlistTypeFilters.length < CATEGORY_OPTIONS.length;
  const movedRowIdRef = useRef<string | null>(null);

  useEffect(() => {
    const rowId = movedRowIdRef.current;
    if (rowId === null) return;
    movedRowIdRef.current = null;
    if (getInputModality() !== "key-navigation") return;
    const button = findMenuButton(rowId);
    if (!button) return;
    focusRingElement(button);
    revealRingElementAfterLayout(button);
  }, [playlist]);

  const apply = (rowId: string, result: ReorderResult<PlaylistItem>) => {
    if (result.items === playlist) return;
    movedRowIdRef.current = rowId;
    setPlaylist(result.items);
    setCurrentIndex(result.currentIndex);
  };

  const playNext = useLatestCallback((id: string) => {
    if (shuffleEnabled) return;
    apply(id, moveAfterCurrent(playlist, currentIndex, id, currentPlayingItemId !== null));
  });
  const move = (id: string, delta: number) => {
    if (shuffleEnabled || filterHidesRows) return;
    apply(id, moveItem(playlist, id, delta, currentIndex));
  };
  const moveUp = useLatestCallback((id: string) => move(id, -1));
  const moveDown = useLatestCallback((id: string) => move(id, 1));

  return useMemo(
    () => ({ shuffleEnabled, filterHidesRows, playNext, moveUp, moveDown }),
    [shuffleEnabled, filterHidesRows, playNext, moveUp, moveDown],
  );
};
