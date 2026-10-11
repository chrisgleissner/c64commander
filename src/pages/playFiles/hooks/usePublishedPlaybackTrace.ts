/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { syncPlaybackDecisionFromTrace } from "@/lib/diagnostics/decisionState";
import type { TracePlaybackContext } from "@/lib/tracing/types";
import { setPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";

/**
 * Publish the Play page's playback state to traces, logs and diagnostics for as long as the page is built. A kept Play
 * page goes on playing and advancing while another tab is shown, and the requests it sends are attributed to this
 * state. Off screen the elapsed time is the one Play last rendered, since it stops ticking each second there.
 */
export const usePublishedPlaybackTrace = (context: TracePlaybackContext | null) => {
  useEffect(() => {
    setPlaybackTraceSnapshot(context);
    syncPlaybackDecisionFromTrace(context, "Play page playback state updated");
  }, [context]);

  useEffect(
    () => () => {
      setPlaybackTraceSnapshot(null);
      syncPlaybackDecisionFromTrace(null, "Play page left; playback state is no longer directly observable");
    },
    [],
  );
};
