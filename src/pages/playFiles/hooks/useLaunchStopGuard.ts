/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { addErrorLog, addLog } from "@/lib/logging";

/**
 * One Stop per launch, and a visible "Stopping…" until the device has answered it.
 *
 * `stopPending` lasts until the stopped launch unwinds: every further Stop in that time sent another reset into
 * the device menu a `.cfg` apply was still walking. `stopping` lasts until Stop's own request settles, so a press
 * shows at once even when the reset takes a moment.
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
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);

  useEffect(() => {
    if (isPlaylistLoading) return;
    stopPendingRef.current = false;
    setStopPending(false);
  }, [isPlaylistLoading]);

  const stopPlayback = useCallback(() => {
    if (stoppingRef.current) {
      addLog("info", "Playback: Stop already sent; waiting for the device to answer it");
      return;
    }
    if (isPlaylistLoading && !isPlaying) {
      if (stopPendingRef.current) {
        addLog("info", "Playback: Stop already sent; waiting for the stopped launch to unwind");
        return;
      }
      stopPendingRef.current = true;
      setStopPending(true);
    }
    stoppingRef.current = true;
    setStopping(true);
    void (async () => {
      try {
        await stop();
      } catch (error) {
        addErrorLog("Playback: Stop failed", {
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      } finally {
        stoppingRef.current = false;
        setStopping(false);
      }
    })();
  }, [isPlaying, isPlaylistLoading, stop]);

  return { stopPending, stopping, stopPlayback };
};
