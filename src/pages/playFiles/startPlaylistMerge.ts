/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * What the queue becomes when a new set of items is started.
 *
 * Two callers want opposite things and both are right:
 *
 *  - **Playing something from the browser or a playlist row** should not throw away what the
 *    listener had queued. The started items go to the front and everything else is kept behind
 *    them, de-duplicated by id.
 *  - **Starting a SID Radio station** must replace the queue outright. A station owns the queue for
 *    as long as it runs, which is why the transport's Shuffle and Repeat are disabled while one is
 *    active.
 *
 * Merging for a station was a defect with three visible consequences, all measured on the Pixel 4
 * against a queue of a few hundred previously-added tunes: the station was only the first ten
 * entries of a much longer queue, so its lookahead refill never fired (`lastRefillMs` stayed null);
 * navigating past the tenth tune left the station without saying so; and the tunes after it had
 * never been through the station's admission rules, so tunes well under the configured minimum
 * length played from a station the listener believed was filtering them.
 */
export const mergeStartedPlaylist = (
  previous: readonly PlaylistItem[],
  started: readonly PlaylistItem[],
  options?: { replaceQueue?: boolean },
): PlaylistItem[] => {
  if (options?.replaceQueue) return [...started];
  if (previous.length === 0) return [...started];
  const startedIds = new Set(started.map((item) => item.id));
  const extras = previous.filter((item) => !startedIds.has(item.id));
  return extras.length ? [...started, ...extras] : [...started];
};
