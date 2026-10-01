/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { addLog } from "@/lib/logging";

/**
 * One Stop per launch. A launch that Stop overtook keeps its start claim until its .cfg apply returns,
 * about 20 s, and every further Stop in that time sent another reset into the device menu the apply
 * was still walking.
 */
export const useLaunchStopGuard = ({
  isPlaylistLoading,
  isPlaying,
  stop,
}: {
  isPlaylistLoading: boolean;
  isPlaying: boolean;
  stop: () => Promise<void>;
}) => {
  const [stopPending, setStopPending] = useState(false);
  const stopPendingRef = useRef(false);

  useEffect(() => {
    if (isPlaylistLoading) return;
    stopPendingRef.current = false;
    setStopPending(false);
  }, [isPlaylistLoading]);

  const stopPlayback = useCallback(() => {
    if (isPlaylistLoading && !isPlaying) {
      if (stopPendingRef.current) {
        addLog("info", "Playback: Stop already sent; waiting for the stopped launch to unwind");
        return;
      }
      stopPendingRef.current = true;
      setStopPending(true);
    }
    void stop();
  }, [isPlaying, isPlaylistLoading, stop]);

  return { stopPending, stopPlayback };
};
