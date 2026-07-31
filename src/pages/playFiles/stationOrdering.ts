/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Who decides the play order: the listener's Shuffle and Repeat switches, or a running station.
 *
 * A station picks the next tune itself, from the similarity walk, and appends it to the end of the
 * queue. Shuffle and Repeat act on the queue instead. If both are allowed to act at once the station
 * stops working as designed in three separate ways:
 *
 *  - Shuffle traverses the queue in a permuted order, so the tune played after the current one is
 *    not the one the walk chose to follow it.
 *  - The refill lookahead counts the tracks after the cursor (`playlist.length - index - 1`), which
 *    only means "how much is left to play" while the queue is traversed in order.
 *  - Repeat sends the cursor back into tracks the station has already served, which is heard as the
 *    station repeating itself.
 *
 * The controls are hidden while a station runs, but hiding a control is a statement about the screen
 * and not about the traversal — the stored values were still being read. This is where the traversal
 * itself is told to ignore them, so the two cannot drift apart.
 *
 * Nothing is written: the listener's own Shuffle and Repeat values are left untouched and apply
 * again the moment the station stops.
 */

export interface TraversalOrdering {
  repeatEnabled: boolean;
  shuffleEnabled: boolean;
}

export const resolveTraversalOrdering = (ordering: TraversalOrdering, stationActive: boolean): TraversalOrdering =>
  stationActive ? { repeatEnabled: false, shuffleEnabled: false } : ordering;
