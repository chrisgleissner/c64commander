/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { NOW_PLAYING_METADATA_SEPARATOR } from "@/lib/playback/nowPlayingMetadata";
import { needsDeviceToPlay } from "./playableWithoutDevice";
import type { PlaylistItem } from "./types";

/**
 * The second line of a playlist row for a file expanded into its tunes, otherwise null.
 *
 * Nineteen rows then carry the same name, and the two facts that tell them apart are which tune
 * this is and what STIL calls it where it has a name. The file name and path are on the details menu.
 */
export const NEEDS_DEVICE_SUBTITLE = "Needs a C64 Ultimate";

export const buildPlaylistRowSubtitle = (item: PlaylistItem, options: { sidPlayer?: boolean } = {}): string | null => {
  if (options.sidPlayer && needsDeviceToPlay(item)) return NEEDS_DEVICE_SUBTITLE;
  const songNr = item.request.songNr;
  const tuneCount = item.subsongCount ?? 0;
  const isOneOfMany = typeof songNr === "number" && songNr > 0 && tuneCount > 1;
  if (!isOneOfMany) return null;

  const segments = [`Tune ${songNr} of ${tuneCount}`];
  const title = item.tuneTitle?.trim();
  if (title) segments.push(title);
  return segments.join(NOW_PLAYING_METADATA_SEPARATOR);
};
