/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";

export const getCurrentPlaybackSnapshotLabel = (): string | undefined => {
  const label = readStoredPlaybackSession()?.currentItemLabel;
  if (typeof label !== "string") return undefined;
  const trimmed = label.trim();
  return trimmed || undefined;
};
