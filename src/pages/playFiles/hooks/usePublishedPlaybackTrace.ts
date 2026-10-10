/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { usePageActivity } from "@/hooks/usePageActivity";
import { syncPlaybackDecisionFromTrace } from "@/lib/diagnostics/decisionState";
import type { TracePlaybackContext } from "@/lib/tracing/types";
import { setPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";

/**
 * Publish the Play page's playback state to traces, logs and diagnostics while Play is the tab on screen. Off screen the
 * page stops re-rendering its elapsed time each second, so its state is withdrawn when the tab is left, as it was when
 * leaving unmounted the page, rather than left to go stale.
 */
export const usePublishedPlaybackTrace = (context: TracePlaybackContext | null) => {
  const pageActive = usePageActivity();

  useEffect(() => {
    if (!pageActive) return;
    setPlaybackTraceSnapshot(context);
    syncPlaybackDecisionFromTrace(context, "Play page playback state updated");
  }, [context, pageActive]);

  useEffect(() => {
    if (!pageActive) return undefined;
    return () => {
      setPlaybackTraceSnapshot(null);
      syncPlaybackDecisionFromTrace(null, "Play page left; playback state is no longer directly observable");
    };
  }, [pageActive]);
};
