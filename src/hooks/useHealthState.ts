/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { getTraceEvents } from "@/lib/tracing/traceSession";
import { getConfiguredHost } from "@/lib/connection/hostEdit";
import { useConnectionState } from "@/hooks/useConnectionState";
import { useHealthCheckState } from "@/lib/diagnostics/healthCheckState";
import {
  type ContributorHealth,
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
import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";

const contributorHealthFromProbe = (
  outcome: "Success" | "Fail" | "Skipped",
  problemCount: number,
): ContributorHealth => ({
  state: outcome === "Success" ? "Healthy" : outcome === "Fail" ? "Unhealthy" : "Idle",
  problemCount,
  totalOperations: 1,
  failedOperations: problemCount,
});

export function useHealthState(): OverallHealthState {
  const connectionSnapshot = useConnectionState();
  const healthCheckState = useHealthCheckState();
  const {
    status: { deviceInfo },
  } = useC64Connection();
  const [traceEvents, setTraceEvents] = useState(getTraceEvents);

  useEffect(() => {
    const handler = () => setTraceEvents(getTraceEvents());
    window.addEventListener("c64u-traces-updated", handler);
    return () => window.removeEventListener("c64u-traces-updated", handler);
  }, []);

  return useMemo(() => {
    const connectivity = deriveConnectivityState(connectionSnapshot.state);
    const host = getConfiguredHost();
    const latestHealthCheck = healthCheckState.latestResult;

    if (latestHealthCheck) {
      const appFailures = [latestHealthCheck.probes.CONFIG, latestHealthCheck.probes.JIFFY].filter(
        (probe) => probe.outcome === "Fail",
      ).length;
      const restFailures = latestHealthCheck.probes.REST.outcome === "Fail" ? 1 : 0;
      const ftpFailures = latestHealthCheck.probes.FTP.outcome === "Fail" ? 1 : 0;
      const contributors = {
        App: contributorHealthFromProbe(appFailures > 0 ? "Fail" : latestHealthCheck.probes.JIFFY.outcome, appFailures),
        REST: contributorHealthFromProbe(latestHealthCheck.probes.REST.outcome, restFailures),
        FTP: contributorHealthFromProbe(latestHealthCheck.probes.FTP.outcome, ftpFailures),
      } as const;
      const problemCount = appFailures + restFailures + ftpFailures;
      const firstFailedProbe = Object.values(latestHealthCheck.probes).find((probe) => probe.outcome === "Fail");

      return {
        state: latestHealthCheck.overallHealth,
        connectivity,
        host,
        connectedDeviceLabel: inferConnectedDeviceLabel(latestHealthCheck.deviceInfo?.product ?? deviceInfo?.product),
        problemCount,
        contributors,
        lastRestActivity: deriveLastRestActivity(traceEvents),
        lastFtpActivity: deriveLastFtpActivity(traceEvents),
        primaryProblem: firstFailedProbe
          ? {
              id: `${latestHealthCheck.runId}-${firstFailedProbe.probe}`,
              title: `${firstFailedProbe.probe} health check failed`,
              contributor:
                firstFailedProbe.probe === "REST" ? "REST" : firstFailedProbe.probe === "FTP" ? "FTP" : "App",
              timestampMs: Date.parse(latestHealthCheck.endTimestamp),
              impactLevel: latestHealthCheck.overallHealth === "Unhealthy" ? 2 : 1,
              causeHint: firstFailedProbe.reason,
            }
          : null,
      };
    }

    // Gate trace-derived health on having seen at least one successful REST response.
    // Before the first clean response, the badge stays Idle (connecting) rather than
    // flipping to Unhealthy from early probe failures or connection-retry noise.
    const hasFirstRestSuccess = traceEvents.some(
      (e) => e.type === "rest-response" && typeof e.data.status === "number" && e.data.status < 400,
    );

    const idleContributors = {
      App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      REST: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    } as const;

    if (!hasFirstRestSuccess) {
      return {
        state: "Idle",
        connectivity,
        host,
        connectedDeviceLabel: inferConnectedDeviceLabel(deviceInfo?.product),
        problemCount: 0,
        contributors: idleContributors,
        lastRestActivity: deriveLastRestActivity(traceEvents),
        lastFtpActivity: deriveLastFtpActivity(traceEvents),
        primaryProblem: null,
      };
    }

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
      connectedDeviceLabel: inferConnectedDeviceLabel(deviceInfo?.product),
      problemCount: totalProblems,
      contributors,
      lastRestActivity: deriveLastRestActivity(traceEvents),
      lastFtpActivity: deriveLastFtpActivity(traceEvents),
      primaryProblem: derivePrimaryProblem(traceEvents, contributors),
    };
  }, [connectionSnapshot.state, deviceInfo?.product, healthCheckState.latestResult, traceEvents]);
}
