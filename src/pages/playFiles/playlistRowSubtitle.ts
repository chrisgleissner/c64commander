/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { NOW_PLAYING_METADATA_SEPARATOR } from "@/lib/playback/nowPlayingMetadata";
import type { PlaylistItem } from "./types";

/**
 * The second line of a playlist row.
 *
 * Normally the file's path, which is what tells one tune from another and where it came from.
 *
 * That breaks down for a file expanded into its tunes: nineteen rows then carry the same name and
 * the same path, and nothing on any of them says which tune it is. So for those rows the path —
 * which is identical on all of them and therefore distinguishes nothing — gives way to the two
 * facts that do: which tune this is, and what STIL calls it where it has a name. The path is still
 * on the row's details menu.
 */
export const buildPlaylistRowSubtitle = (item: PlaylistItem): string => {
  const songNr = item.request.songNr;
  const tuneCount = item.subsongCount ?? 0;
  const isOneOfMany = typeof songNr === "number" && songNr > 0 && tuneCount > 1;
  if (!isOneOfMany) return item.path;

  const segments = [`Tune ${songNr} of ${tuneCount}`];
  const title = item.tuneTitle?.trim();
  if (title) segments.push(title);
  return segments.join(NOW_PLAYING_METADATA_SEPARATOR);
};
