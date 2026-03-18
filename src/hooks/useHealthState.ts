/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { getTraceEvents } from "@/lib/tracing/traceSession";
import { getConfiguredHost } from "@/lib/connection/hostEdit";
import { useConnectionState } from "@/hooks/useConnectionState";
import {
  deriveAppContributorHealth,
  deriveConnectivityState,
  deriveFtpContributorHealth,
  deriveLastFtpActivity,
  deriveLastRestActivity,
  derivePrimaryProblem,
  deriveRestContributorHealth,
  rollUpHealth,
  type OverallHealthState,
} from "@/lib/diagnostics/healthModel";

export function useHealthState(): OverallHealthState {
  const connectionSnapshot = useConnectionState();
  const [traceEvents, setTraceEvents] = useState(getTraceEvents);

  useEffect(() => {
    const handler = () => setTraceEvents(getTraceEvents());
    window.addEventListener("c64u-traces-updated", handler);
    return () => window.removeEventListener("c64u-traces-updated", handler);
  }, []);

  return useMemo(() => {
    const connectivity = deriveConnectivityState(connectionSnapshot.state);
    const host = getConfiguredHost();

    const contributors = {
      App: deriveAppContributorHealth(traceEvents),
      REST: deriveRestContributorHealth(traceEvents),
      FTP: deriveFtpContributorHealth(traceEvents),
    } as const;

    const state = rollUpHealth(contributors, connectivity);
    const totalProblems =
      contributors.App.problemCount + contributors.REST.problemCount + contributors.FTP.problemCount;

    return {
      state,
      connectivity,
      host,
      problemCount: totalProblems,
      contributors,
      lastRestActivity: deriveLastRestActivity(traceEvents),
      lastFtpActivity: deriveLastFtpActivity(traceEvents),
      primaryProblem: derivePrimaryProblem(traceEvents, contributors),
    };
  }, [connectionSnapshot.state, traceEvents]);
}
