/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { NOW_PLAYING_METADATA_SEPARATOR } from "@/lib/playback/nowPlayingMetadata";
import type { PlaylistItem } from "./types";

const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The second line of a playlist row, or null when the row has nothing to add to its title.
 *
 * The folder is on the group header above the row, so the line carries only the file name, and only
 * when the title shows something else (a friendly SID name). A file expanded into its tunes is the
 * exception: nineteen rows then carry the same name, and the two facts that tell them apart are
 * which tune this is and what STIL calls it where it has a name. The full path is on the details menu.
 */
const nameKey = (value: string) =>
  value
    .replace(/\.[A-Za-z0-9]{1,4}$/, "")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();

const sameNameIgnoringExtension = (fileName: string, title: string) => nameKey(fileName) === nameKey(title);

export const buildPlaylistRowSubtitle = (item: PlaylistItem, displayTitle: string): string | null => {
  const songNr = item.request.songNr;
  const tuneCount = item.subsongCount ?? 0;
  const isOneOfMany = typeof songNr === "number" && songNr > 0 && tuneCount > 1;
  if (!isOneOfMany) {
    const fileName = fileNameOf(item.path);
    return sameNameIgnoringExtension(fileName, displayTitle) ? null : fileName;
  }

  const segments = [`Tune ${songNr} of ${tuneCount}`];
  const title = item.tuneTitle?.trim();
  if (title) segments.push(title);
  return segments.join(NOW_PLAYING_METADATA_SEPARATOR);
};
