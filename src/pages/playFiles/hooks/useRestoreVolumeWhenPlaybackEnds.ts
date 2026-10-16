/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { addErrorLog } from "@/lib/logging";

/**
 * Ends the volume session, restoring the C64's pre-playback mixer levels, once playback has stopped.
 *
 * Not before the stored playback session has been restored. A remount (a re-selected tab, a relaunch) re-owns the
 * volume session at once, and the page's initial stopped state then ended it mid-tune: the pre-playback levels were
 * written over a held Mute.
 */
export const useRestoreVolumeWhenPlaybackEnds = ({
  sessionRestoreSettled,
  isPlaying,
  isPaused,
  volumeSessionActiveRef,
  restoreVolumeOverrides,
}: {
  sessionRestoreSettled: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  volumeSessionActiveRef: { readonly current: boolean };
  restoreVolumeOverrides: (reason: string) => Promise<void>;
}) => {
  useEffect(() => {
    if (!sessionRestoreSettled || isPlaying || isPaused) return;
    if (!volumeSessionActiveRef.current) return;
    void restoreVolumeOverrides("playback-ended").catch((error: unknown) => {
      addErrorLog("Volume restore failed after playback ended", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  }, [isPaused, isPlaying, restoreVolumeOverrides, sessionRestoreSettled, volumeSessionActiveRef]);
};
