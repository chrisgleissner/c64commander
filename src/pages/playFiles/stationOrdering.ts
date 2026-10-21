/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** A live station owns its traversal order. Explicit Repeat playlist may wrap the retained
 * queue when it runs out; Stop station still lets the final tune finish exactly once.
 * Shuffle converts the station to a regular playlist before it takes effect.
 */

export interface TraversalOrdering {
  repeatEnabled: boolean;
  shuffleEnabled: boolean;
}

export const resolveTraversalOrdering = (
  ordering: TraversalOrdering,
  stationActive: boolean,
  stationFinishing = false,
): TraversalOrdering => ({
  repeatEnabled: ordering.repeatEnabled && !stationFinishing,
  shuffleEnabled: ordering.shuffleEnabled && !stationActive,
});
