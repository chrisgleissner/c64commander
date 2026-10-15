/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createPlaybackTimeStore, type PlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";

/** A real playback time store whose setters also report to the given spies. */
export const spiedPlaybackTime = ({
  elapsedMs = 0,
  playedMs = 0,
  setElapsedMs,
  setPlayedMs,
}: {
  elapsedMs?: number;
  playedMs?: number;
  setElapsedMs?: (value: number) => void;
  setPlayedMs?: (value: number) => void;
} = {}): PlaybackTimeStore => {
  const store = createPlaybackTimeStore({ elapsedMs, playedMs });
  return {
    ...store,
    setElapsedMs: (value) => {
      setElapsedMs?.(value);
      store.setElapsedMs(value);
    },
    setPlayedMs: (value) => {
      setPlayedMs?.(value);
      store.setPlayedMs(value);
    },
  };
};
