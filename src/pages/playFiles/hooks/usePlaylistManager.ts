/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadRepeatOneEnabled, saveRepeatOneEnabled } from "@/lib/config/appSettings";
import { CATEGORY_OPTIONS, generateShuffleSeed } from "../playFilesUtils";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import type { PlaylistItem } from "@/pages/playFiles/types";

export function usePlaylistManager() {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shuffleEnabled, setShuffleState] = useState(false);
  const shuffleEnabledRef = useRef(false);
  // The curated playlist array is never reordered for shuffle - it is a
  // non-destructive playback-order layer keyed by this seed (see
  // resolveNextPlaylistIndex/resolvePreviousPlaylistIndex in
  // playFilesUtils.ts). See HARD9-007.
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  const [shuffleAnchorId, setShuffleAnchorId] = useState<string | null>(null);
  const shuffleContextRef = useRef({ playlist, currentIndex });
  shuffleContextRef.current = { playlist, currentIndex };
  const [repeatOneEnabled, setRepeatOneState] = useState(loadRepeatOneEnabled);
  const setRepeatOneEnabled = (value: boolean) => {
    saveRepeatOneEnabled(value);
    setRepeatOneState(value);
  };
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [playlistTypeFilters, setPlaylistTypeFilters] = useState<PlayFileCategory[]>(CATEGORY_OPTIONS);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  // Changing traversal order never changes the playing item or its playback clock.
  const setShuffleEnabled = useCallback((enabled: boolean) => {
    if (enabled && !shuffleEnabledRef.current) {
      setShuffleSeed(generateShuffleSeed());
      const context = shuffleContextRef.current;
      setShuffleAnchorId(context.playlist[Math.max(0, context.currentIndex)]?.id ?? null);
    }
    shuffleEnabledRef.current = enabled;
    setShuffleState(enabled);
  }, []);

  useEffect(() => {
    setSelectedPlaylistIds((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(playlist.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [playlist]);

  // Legacy sessions may have no seed/anchor; Shuffle can also be enabled before adding songs.
  useEffect(() => {
    if (!shuffleEnabled) return;
    if (shuffleSeed === null) setShuffleSeed(generateShuffleSeed());
    if (shuffleAnchorId === null && playlist.length) {
      setShuffleAnchorId(playlist[Math.max(0, currentIndex)]?.id ?? playlist[0].id);
    }
  }, [shuffleEnabled, shuffleSeed, shuffleAnchorId, playlist, currentIndex]);

  return {
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    shuffleEnabled,
    setShuffleEnabled,
    shuffleSeed,
    setShuffleSeed,
    shuffleAnchorId,
    setShuffleAnchorId,
    repeatOneEnabled,
    setRepeatOneEnabled,
    repeatEnabled,
    setRepeatEnabled,
    playlistTypeFilters,
    setPlaylistTypeFilters,
    selectedPlaylistIds,
    setSelectedPlaylistIds,
    isPlaylistLoading,
    setIsPlaylistLoading,
  };
}
