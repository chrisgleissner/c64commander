/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useLatestCallback } from "@/hooks/useLatestCallback";
import { planPlaylistItemRemoval } from "@/pages/playFiles/playbackGuards";
import {
  captureRemovedRows,
  describeRemoval,
  restoreRemovedRows,
  type RemovedRow,
} from "@/pages/playFiles/playlistRemoval";
import type { PlaylistItem } from "@/pages/playFiles/types";

// A keypad user reaches Undo through the quick menu, which takes longer than the notice duration allows.
export const REMOVAL_UNDO_DURATION_MS = 12_000;

type PlaylistRemovalOptions = {
  playlist: PlaylistItem[];
  currentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  stopPlayback: () => void;
  setPlaylist: Dispatch<SetStateAction<PlaylistItem[]>>;
  setCurrentIndex: (index: number) => void;
  setSelectedPlaylistIds: Dispatch<SetStateAction<Set<string>>>;
};

/**
 * Removes playlist rows. `removePlaylistItemsById` is silent, for removals the user did not ask for;
 * `removeWithUndo` is for every removal the user asked for and leaves a notification whose Undo puts the
 * rows back at their positions. Undo restores rows only: playback that the removal stopped stays stopped.
 */
export const usePlaylistRemoval = ({
  playlist,
  currentIndex,
  isPlaying,
  isPaused,
  stopPlayback,
  setPlaylist,
  setCurrentIndex,
  setSelectedPlaylistIds,
}: PlaylistRemovalOptions) => {
  const removePlaylistItemsById = useCallback(
    (ids: Set<string>) => {
      if (!ids.size) return;
      const plan = planPlaylistItemRemoval(playlist, currentIndex, ids, isPlaying, isPaused);
      if (plan.shouldStopDevice) {
        // HARD9-030: the full teardown, so the C64 stops a track the playlist no longer has and the
        // native auto-advance due-time is cleared.
        stopPlayback();
      }
      setPlaylist(plan.next);
      if (currentIndex >= 0) setCurrentIndex(plan.nextCurrentIndex);
      setSelectedPlaylistIds((prev) => {
        if (!prev.size) return prev;
        return new Set(Array.from(prev).filter((id) => !ids.has(id)));
      });
    },
    [currentIndex, stopPlayback, isPaused, isPlaying, playlist, setPlaylist, setCurrentIndex, setSelectedPlaylistIds],
  );

  const undoRemoval = useLatestCallback((removed: RemovedRow[]) => {
    const restored = restoreRemovedRows(playlist, currentIndex, removed);
    setPlaylist(restored.items);
    if (currentIndex >= 0) setCurrentIndex(restored.currentIndex);
  });

  const removeWithUndo = useLatestCallback((ids: Set<string>) => {
    const removed = captureRemovedRows(playlist, ids);
    if (!removed.length) return;
    removePlaylistItemsById(ids);
    toast({
      title: describeRemoval(removed.length),
      alwaysVisible: true,
      duration: REMOVAL_UNDO_DURATION_MS,
      action: (
        <ToastAction altText="Undo removal" onClick={() => undoRemoval(removed)}>
          Undo
        </ToastAction>
      ),
    });
  });

  return { removePlaylistItemsById, removeWithUndo };
};
