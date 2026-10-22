/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "./types";
export type PendingUserSkip = {
  timer: number | null;
  originIndex: number;
  originItemId?: string;
  targetItemId?: string;
  originTrackInstanceId: number;
  targetIndex: number | null;
  stopAtEnd: boolean;
  operation: "PLAYBACK_NEXT" | "PLAYBACK_PREVIOUS";
  title: "Playback next failed" | "Playback previous failed";
  resolvers: Array<{
    resolve: () => void;
  }>;
};

/** Radio retention can evict earlier rows while a user skip waits for a running launch. */
export const resolvePendingSkipIndices = (playlist: readonly PlaylistItem[], pending: PendingUserSkip) => ({
  originIndex: pending.originItemId
    ? playlist.findIndex((item) => item.id === pending.originItemId)
    : pending.originIndex,
  targetIndex: pending.targetItemId
    ? playlist.findIndex((item) => item.id === pending.targetItemId)
    : pending.targetIndex,
});
