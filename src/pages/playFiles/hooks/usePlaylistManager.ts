/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORY_OPTIONS, generateShuffleSeed } from "../playFilesUtils";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaylistItem } from "@/pages/playFiles/types";

export function usePlaylistManager() {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  // The curated playlist array is never reordered for shuffle - it is a
  // non-destructive playback-order layer keyed by this seed (see
  // resolveNextPlaylistIndex/resolvePreviousPlaylistIndex in
  // playFilesUtils.ts). See HARD9-007.
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [playlistTypeFilters, setPlaylistTypeFilters] = useState<PlayFileCategory[]>(CATEGORY_OPTIONS);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  const [reshuffleActive, setReshuffleActive] = useState(false);

  const reshuffleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedPlaylistIds((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(playlist.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [playlist]);

  // Lazily generate a shuffle order the first time shuffle is turned on.
  useEffect(() => {
    if (shuffleEnabled && shuffleSeed === null) {
      setShuffleSeed(generateShuffleSeed());
    }
  }, [shuffleEnabled, shuffleSeed]);

  const handleReshuffle = useCallback(() => {
    if (!shuffleEnabled || !playlist.length) return;
    setReshuffleActive(true);
    if (reshuffleTimerRef.current) {
      window.clearTimeout(reshuffleTimerRef.current);
    }
    reshuffleTimerRef.current = window.setTimeout(() => {
      setReshuffleActive(false);
      reshuffleTimerRef.current = null;
    }, 200);
    // "Reshuffle" is a new seed for the non-destructive order layer, not a
    // physical reorder of the curated playlist.
    setShuffleSeed(generateShuffleSeed());
  }, [playlist.length, shuffleEnabled]);

  useEffect(
    () => () => {
      if (reshuffleTimerRef.current) {
        window.clearTimeout(reshuffleTimerRef.current);
        reshuffleTimerRef.current = null;
      }
    },
    [],
  );

  return {
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    shuffleEnabled,
    setShuffleEnabled,
    shuffleSeed,
    setShuffleSeed,
    repeatEnabled,
    setRepeatEnabled,
    playlistTypeFilters,
    setPlaylistTypeFilters,
    selectedPlaylistIds,
    setSelectedPlaylistIds,
    isPlaylistLoading,
    setIsPlaylistLoading,
    reshuffleActive,
    setReshuffleActive,
    handleReshuffle,
  };
}
