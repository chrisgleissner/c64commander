/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlayFile } from "@/lib/types";

export const LEGACY_PLAYLIST_MAX_ITEMS = 1000;
export const LEGACY_PLAYLIST_MAX_BYTES = 512 * 1024;

export const shouldPersistLegacyPlaylistBlob = (playlist: PlayFile[], payloadBytes: number) => {
  if (playlist.length > LEGACY_PLAYLIST_MAX_ITEMS) {
    return false;
  }
  if (payloadBytes > LEGACY_PLAYLIST_MAX_BYTES) {
    return false;
  }
  return true;
};
