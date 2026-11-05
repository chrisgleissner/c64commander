/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** From this much play onward, Prev restarts the current item instead of going back to the one before it. */
export const PREV_RESTARTS_FROM_MS = 3000;

/**
 * The item Prev plays: the current one again once it has played for {@link PREV_RESTARTS_FROM_MS}, otherwise the
 * one before it. A quick second press therefore always reaches the previous item.
 */
export const prevTargetIndex = (playedMs: number, currentIndex: number, previousIndex: number): number =>
  playedMs >= PREV_RESTARTS_FROM_MS ? currentIndex : previousIndex;

/**
 * How long the current item has played. While an earlier skip is still launching, the item it chose has not played
 * at all. While it plays, that is the time since its start, which the playhead anchor keeps aligned with what is
 * audible. While paused, that start keeps receding, so the shown position is used instead. The playlist's played
 * clock is no use here: it runs on across items.
 */
export const currentItemPlayedMs = ({
  earlierSkipLaunching,
  trackStartedAtMs,
  paused,
  shownElapsedMs,
  now,
}: {
  earlierSkipLaunching: boolean;
  trackStartedAtMs: number | null;
  paused: boolean;
  shownElapsedMs: number;
  now: number;
}): number => {
  if (earlierSkipLaunching) return 0;
  return paused || trackStartedAtMs === null ? shownElapsedMs : Math.max(0, now - trackStartedAtMs);
};
