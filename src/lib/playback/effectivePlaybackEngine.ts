/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isSidPlayerActive } from "@/lib/appMode/appModeStore";
import { loadPlaybackEngine, type PlaybackEngine } from "@/lib/config/appSettings";

/** SID Player has no device to play on, so every tune plays here whatever the stored choice says. */
export const effectivePlaybackEngine = (): PlaybackEngine => (isSidPlayerActive() ? "local" : loadPlaybackEngine());
