/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";

import {
  isLocalPlaybackActive,
  isRemotePlaybackActive,
  subscribeActivePlayback,
} from "@/lib/playback/activePlaybackSession";

/**
 * What is playing right now, app-wide — not "what this page thinks".
 *
 * `useSyncExternalStore` because the truth is module-level and outlives the
 * component: a Play page can mount mid-tune, and it must render a working
 * transport on its first paint rather than after an async session restore.
 * Reading through the store also means a page that never started the playback
 * still sees it.
 */
export interface ActivePlayback {
  /** A tune is rendering on this device. */
  local: boolean;
  /** A tune is running on the connected C64. */
  remote: boolean;
  /** Either of the above. */
  any: boolean;
}

export const useActivePlayback = (): ActivePlayback => {
  // Snapshots must be referentially stable between notifications or
  // useSyncExternalStore re-renders forever, so the two booleans are packed
  // into one primitive and unpacked after the subscription reads it.
  const packed = useSyncExternalStore(
    subscribeActivePlayback,
    () => (isLocalPlaybackActive() ? 1 : 0) | (isRemotePlaybackActive() ? 2 : 0),
    // Server/prerender: nothing is playing.
    () => 0,
  );
  const local = (packed & 1) !== 0;
  const remote = (packed & 2) !== 0;
  return { local, remote, any: local || remote };
};
