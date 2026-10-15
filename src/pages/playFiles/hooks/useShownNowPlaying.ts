/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import { readLocalPlayOut, subscribeLocalPlayOut } from "@/lib/playback/localPlayOut";
import { createPlaybackTimeStore, type PlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import type { PlaylistItem } from "@/pages/playFiles/types";

/** The tune on screen while the phone plays it out after the playlist has moved on. */
export type NowPlayingHold = {
  item: PlaylistItem | undefined;
  index: number;
  durationMs: number | undefined;
  elapsedMs: number;
  heldAtMs: number;
};

/** The held tune's elapsed time at `nowMs`: it runs on from where it was shown, up to its songlength. */
export const heldElapsedMs = (hold: NowPlayingHold, nowMs: number) =>
  Math.min(hold.durationMs ?? Number.POSITIVE_INFINITY, hold.elapsedMs + Math.max(0, nowMs - hold.heldAtMs));

/** How often the held tune's clock is redrawn. */
const HELD_TICK_MS = 250;

/**
 * What the Play page names as playing: the playlist's current tune, except while the phone is still
 * playing out the previous one (`localPlayOut`). Then the previous tune's title, row, duration and
 * clock stay on screen until its last sample has played. Only what is shown is held; the playlist,
 * the auto-advance and everything else keep following the current tune.
 */
export const useShownNowPlaying = ({
  playlist,
  currentIndex,
  durationMs,
  playbackTime,
}: {
  playlist: PlaylistItem[];
  currentIndex: number;
  durationMs: number | undefined;
  playbackTime: PlaybackTimeStore;
}) => {
  const [hold, setHold] = useState<NowPlayingHold | null>(null);
  const [shownTime] = useState(() => createPlaybackTimeStore(playbackTime.read()));
  const shown = hold
    ? { item: hold.item, index: hold.index, durationMs: hold.durationMs }
    : { item: playlist[currentIndex], index: currentIndex, durationMs };
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(
    () =>
      subscribeLocalPlayOut(() => {
        const heldAtMs = Date.now();
        if (readLocalPlayOut()) {
          setHold({ ...shownRef.current, elapsedMs: shownTime.read().elapsedMs, heldAtMs });
          return;
        }
        // In the same update as the title, so the next tune is never drawn with the held tune's clock.
        shownTime.set(playbackTime.read());
        setHold(null);
      }),
    [playbackTime, shownTime],
  );

  useEffect(() => {
    if (!hold) {
      const follow = () => shownTime.set(playbackTime.read());
      follow();
      return playbackTime.subscribe(follow);
    }
    const tick = () =>
      shownTime.set({ elapsedMs: heldElapsedMs(hold, Date.now()), playedMs: playbackTime.read().playedMs });
    tick();
    const timer = setInterval(tick, HELD_TICK_MS);
    return () => clearInterval(timer);
  }, [hold, playbackTime, shownTime]);

  return { ...shown, time: shownTime };
};
