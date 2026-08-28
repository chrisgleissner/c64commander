/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The four things offered before anything is typed (spec.md section 6.3).
 *
 * One list, because there are two places that show it — Home's tiles and the search overlay's chips
 * on an empty query — and they had drifted: Home offered Live View as the fourth and the overlay
 * offered the Play page. Whichever is right, they cannot both be, and a reader who saw one and then
 * the other would be looking at the same feature described two ways.
 *
 * The entries are ids in the search index, so both consumers resolve them through the same
 * requirement rules and a promoted action that cannot be used right now is shown disabled with its
 * reason rather than hidden.
 */
export const PROMOTED_ENTRY_IDS: readonly string[] = [
  "action.sid-radio",
  "action.resume-session",
  "action.recently-played",
  "home.section.live-view",
];
