/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { RomDependentSongRefused, RomDependentSongSkipped } from "@/lib/romDependency/romDependencyPolicy";
import { markPlaybackErrorReported } from "@/pages/playFiles/playbackErrorReported";
import { announceSkippedSong, type RomDependencyDecider } from "@/pages/playFiles/resolveLocalRoute";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * The renderer answered `romRequired` for a song that was sent to it: nothing is sounding, so the launch
 * must not become a playing state. A playlist moving on passes the song over; a chosen song is explained
 * with the dialog that has no Play anyway, and then refused as an error that has already been reported.
 */
export const rejectRefusedLaunch = async (
  item: PlaylistItem,
  passOver: boolean,
  ask: RomDependencyDecider | undefined,
): Promise<never> => {
  addLog("warn", "The renderer refused a song that needs the C64 ROMs", {
    service: "rom-dependency",
    item: item.label,
  });
  if (passOver) {
    announceSkippedSong(item.label, true);
    throw new RomDependentSongSkipped(item.label);
  }
  await ask?.(item, { canPlayAnyway: false });
  const refused = new RomDependentSongRefused(item.label);
  markPlaybackErrorReported(refused);
  throw refused;
};
