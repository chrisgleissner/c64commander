/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useRef, useState } from "react";

/**
 * Whether the last song of the playlist auto-ended (HARD12-018). Background execution stops on it even though
 * `isPlaying` stays true, because a song on the C64 plays on and Stop must remain available. Reset when a track
 * starts. The ref lets callbacks read it without depending on it.
 */
export const usePlaylistEnded = () => {
  const [playlistEnded, setPlaylistEndedState] = useState(false);
  const playlistEndedRef = useRef(false);
  const setPlaylistEnded = useCallback((ended: boolean) => {
    playlistEndedRef.current = ended;
    setPlaylistEndedState(ended);
  }, []);
  return { playlistEnded, setPlaylistEnded, playlistEndedRef };
};

/**
 * Where a resumed track's clock is anchored, or null to keep it stopped. After the playlist ran out the clock stays at
 * the song's end, where `finishPlaylistPlayback` stopped it, even though a song on the C64 plays on and can be paused.
 */
export const resumedTrackStartedAtMs = (playlistEnded: boolean, nowMs: number, elapsedMs: number): number | null =>
  playlistEnded ? null : nowMs - elapsedMs;
