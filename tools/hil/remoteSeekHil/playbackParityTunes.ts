/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over its local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { counterPsid, type CounterTune } from "./tunes";

/** Match the generated C64 fixture's header to the title the parity driver locates in the playlist. */
export const playbackParityCounterPsid = (tune: CounterTune) => counterPsid(tune, "Seek_Counter");
