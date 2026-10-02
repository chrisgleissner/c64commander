/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { getConfiguredHost } from "@/lib/connection/hostEdit";
import { useConnectionState } from "@/hooks/useConnectionState";
import { AUTH_REQUIRED_PROBE_ERROR } from "@/lib/connection/connectionManager";
import { isRevalidatingConnection, subscribeConnectionRevalidation } from "@/lib/connection/connectionRevalidation";
import { useHealthCheckState } from "@/lib/diagnostics/healthCheckState";
import type { HealthCheckProbeOutcome } from "@/lib/diagnostics/healthHistory";
import {
  type ContributorHealth,
  deriveConnectivityState,
  rollUpHealth,
  type OverallHealthState,
} from "@/lib/diagnostics/healthModel";
import {
  getHealthRecheckGeneration,
  readHealthTraceEvents,
  retainHealthProblemRecheck,
  selectSharedTraceHealth,
  subscribeHealthTraceUpdates,
} from "@/lib/diagnostics/healthTraceStore";
import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";
import { buildSavedDevicePrimaryLabel } from "@/lib/savedDevices/store";

const contributorHealthFromProbe = (outcome: HealthCheckProbeOutcome, problemCount: number): ContributorHealth => ({
  state:
    outcome === "Success" ? "Healthy" : outcome === "Fail" ? "Unhealthy" : outcome === "Partial" ? "Degraded" : "Idle",
  problemCount,
  totalOperations: 1,
  failedOperations: problemCount,
});

type IdentityDeviceInfo = {
  product?: string | null;
  firmware_version?: string | null;
};

const hasVerifiedDeviceIdentity = (deviceInfo: IdentityDeviceInfo | null | undefined) =>
  Boolean(deviceInfo?.product?.trim() && deviceInfo?.firmware_version?.trim());

const applyIdentityHealthGate = (
  health: OverallHealthState,
  deviceInfo: IdentityDeviceInfo | null | undefined,
): OverallHealthState => {
  if (health.connectivity !== "Online" || health.state !== "Healthy" || hasVerifiedDeviceIdentity(deviceInfo)) {
    return health;
  }

  const appContributor = health.contributors.App;
  return {
    ...health,
    state: "Degraded",
    problemCount: health.problemCount + 1,
    contributors: {
      ...health.contributors,
      App: {
        ...appContributor,
        state: appContributor.state === "Unhealthy" ? "Unhealthy" : "Degraded",
        problemCount: appContributor.problemCount + 1,
        totalOperations: appContributor.totalOperations + 1,
        failedOperations: appContributor.failedOperations + 1,
      },
    },
    primaryProblem:
      health.primaryProblem ??
      ({
        id: "device-identity-unavailable",
        title: "Device identity unavailable",
        contributor: "App",
        timestampMs: Date.now(),
        impactLevel: 1,
        causeHint: "Product and firmware have not been verified for the active target.",
      } satisfies OverallHealthState["primaryProblem"]),
  };
};

export function useHealthState(): OverallHealthState {
  const connectionSnapshot = useConnectionState();
  // The same getter serves the server snapshot: the flag starts false and only a resume probe sets
  // it, so there is nothing a second reader could say differently.
  const revalidatingConnection = useSyncExternalStore(
    subscribeConnectionRevalidation,
    isRevalidatingConnection,
    isRevalidatingConnection,
  );
  const healthCheckState = useHealthCheckState();
  const savedDevices = useSavedDevices();
  const {
    status: { deviceInfo },
  } = useC64Connection();
  const [traceEvents, setTraceEvents] = useState(readHealthTraceEvents);
  const [recheckGeneration, setRecheckGeneration] = useState(getHealthRecheckGeneration);

  useEffect(
    () =>
      subscribeHealthTraceUpdates(() => {
        setTraceEvents(readHealthTraceEvents());
        setRecheckGeneration(getHealthRecheckGeneration());
      }),
    [],
  );

  const health = useMemo<OverallHealthState>(() => {
    const connectivity = deriveConnectivityState(
      connectionSnapshot.state,
      connectionSnapshot.lastProbeError === AUTH_REQUIRED_PROBE_ERROR,
      revalidatingConnection,
    );
    const host = getConfiguredHost();
    const latestHealthCheck = healthCheckState.latestResult;
    const selectedSavedDevice =
      savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ??
      savedDevices.devices[0] ??
      null;
    const connectedDeviceLabel = selectedSavedDevice
      ? buildSavedDevicePrimaryLabel(selectedSavedDevice)
      : inferConnectedDeviceLabel(deviceInfo?.product);

    const traceHealth = selectSharedTraceHealth({
      events: traceEvents,
      host,
      deviceId: selectedSavedDevice?.id ?? null,
      latestHealthCheck,
      recheckGeneration,
    });
    const lastActivities = {
      lastRestActivity: traceHealth.lastRestActivity,
      lastFtpActivity: traceHealth.lastFtpActivity,
      lastTelnetActivity: traceHealth.lastTelnetActivity,
    };

    if (latestHealthCheck && traceHealth.kind === "pinned-health-check") {
      const appFailures = [latestHealthCheck.probes.CONFIG, latestHealthCheck.probes.JIFFY].filter(
        (probe) => probe.outcome === "Fail",
      ).length;
      const restFailures = latestHealthCheck.probes.REST.outcome === "Fail" ? 1 : 0;
      const ftpFailures = latestHealthCheck.probes.FTP.outcome === "Fail" ? 1 : 0;
      const telnetFailures = latestHealthCheck.probes.TELNET.outcome === "Fail" ? 1 : 0;
      const contributors = {
        App: contributorHealthFromProbe(appFailures > 0 ? "Fail" : latestHealthCheck.probes.JIFFY.outcome, appFailures),
        REST: contributorHealthFromProbe(latestHealthCheck.probes.REST.outcome, restFailures),
        FTP: contributorHealthFromProbe(latestHealthCheck.probes.FTP.outcome, ftpFailures),
        TELNET: contributorHealthFromProbe(latestHealthCheck.probes.TELNET.outcome, telnetFailures),
      } as const;
      const problemCount = appFailures + restFailures + ftpFailures + telnetFailures;
      const firstFailedProbe = Object.values(latestHealthCheck.probes).find((probe) => probe.outcome === "Fail");

      return applyIdentityHealthGate(
        {
          state: latestHealthCheck.overallHealth,
          connectivity,
          host,
          connectedDeviceLabel,
          problemCount,
          contributors,
          ...lastActivities,
          primaryProblem: firstFailedProbe
            ? {
                id: `${latestHealthCheck.runId}-${firstFailedProbe.probe}`,
                title: `${firstFailedProbe.probe} health check failed`,
                contributor:
                  firstFailedProbe.probe === "REST"
                    ? "REST"
                    : firstFailedProbe.probe === "FTP"
                      ? "FTP"
                      : firstFailedProbe.probe === "TELNET"
                        ? "TELNET"
                        : "App",
                timestampMs: Date.parse(latestHealthCheck.endTimestamp),
                impactLevel: latestHealthCheck.overallHealth === "Unhealthy" ? 2 : 1,
                causeHint: firstFailedProbe.reason,
              }
            : null,
        },
        deviceInfo,
      );
    }

    if (traceHealth.kind !== "trace-derived") {
      return {
        state: "Idle",
        connectivity,
        host,
        connectedDeviceLabel,
        problemCount: 0,
        contributors: {
          App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
          REST: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
          FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
          TELNET: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
        },
        ...lastActivities,
        primaryProblem: null,
      };
    }

    const { contributors } = traceHealth;
    const totalProblems =
      contributors.App.problemCount +
      contributors.REST.problemCount +
      contributors.FTP.problemCount +
      contributors.TELNET.problemCount;

    return applyIdentityHealthGate(
      {
        state: rollUpHealth(contributors, connectivity),
        connectivity,
        host,
        connectedDeviceLabel,
        problemCount: totalProblems,
        contributors,
        ...lastActivities,
        primaryProblem: traceHealth.primaryProblem,
      },
      deviceInfo,
    );
  }, [
    connectionSnapshot.state,
    connectionSnapshot.lastProbeError,
    revalidatingConnection,
    deviceInfo?.firmware_version,
    deviceInfo?.product,
    healthCheckState.latestResult,
    savedDevices,
    traceEvents,
    recheckGeneration,
  ]);

  const hasProblems = health.problemCount > 0;
  useEffect(() => (hasProblems ? retainHealthProblemRecheck() : undefined), [hasProblems]);

  return health;
}
