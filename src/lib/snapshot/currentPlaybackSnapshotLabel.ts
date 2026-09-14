/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";

// Only a tune playing now names the snapshot, and a file on another Ultimate cannot be playing on this one:
// a session paused on the C64 Ultimate hours earlier named a snapshot of a freshly reset Ultimate 64 "Chess.sid".
export const getCurrentPlaybackSnapshotLabel = (): string | undefined => {
  const session = readStoredPlaybackSession();
  if (session?.isPlaying !== true || session.isPaused === true) return undefined;
  const itemId = session.currentItemId ?? "";
  if (itemId.startsWith("ultimate:") && !itemId.startsWith(`ultimate:${getSelectedSavedDevice()?.id}:`)) {
    return undefined;
  }
  const label = session.currentItemLabel;
  if (typeof label !== "string") return undefined;
  const trimmed = label.trim();
  return trimmed || undefined;
};
