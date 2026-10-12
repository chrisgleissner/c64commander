/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Whether this environment can play SIDs on the device: a Web Worker and Web Audio. */
export const localSidPlaybackSupported = (): boolean =>
  typeof Worker !== "undefined" &&
  (typeof AudioContext !== "undefined" ||
    typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined");
