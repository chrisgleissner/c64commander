/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { getTraceEvents } from "@/lib/tracing/traceSession";
import type { TraceEvent } from "@/lib/tracing/types";
import { getConfiguredHost } from "@/lib/connection/hostEdit";
import { useConnectionState } from "@/hooks/useConnectionState";
import { useHealthCheckState } from "@/lib/diagnostics/healthCheckState";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import type { HealthCheckProbeOutcome } from "@/lib/diagnostics/healthHistory";
import {
  type ContributorHealth,
  deriveAppContributorHealth,
  deriveConnectivityState,
  deriveFtpContributorHealth,
  deriveLastFtpActivity,
  deriveLastRestActivity,
  deriveLastTelnetActivity,
  type DeviceScope,
  derivePrimaryProblem,
  deriveRestContributorHealth,
  deriveTelnetContributorHealth,
  rollUpHealth,
  type OverallHealthState,
} from "@/lib/diagnostics/healthModel";
import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";
import { buildSavedDevicePrimaryLabel } from "@/lib/savedDevices/store";
import { addLog, buildErrorLogDetails } from "@/lib/logging";

const contributorHealthFromProbe = (outcome: HealthCheckProbeOutcome, problemCount: number): ContributorHealth => ({
  state:
    outcome === "Success" ? "Healthy" : outcome === "Fail" ? "Unhealthy" : outcome === "Partial" ? "Degraded" : "Idle",
  problemCount,
  totalOperations: 1,
  failedOperations: problemCount,
});

const TRACE_URL_FALLBACK_BASE = "http://localhost";

const resolveTraceTransportHost = (event: TraceEvent<Record<string, unknown>>) => {
  const transportHostname = typeof event.data.hostname === "string" ? event.data.hostname : null;
  if (transportHostname) {
    return stripPortFromDeviceHost(transportHostname);
  }

  const url = typeof event.data.url === "string" ? event.data.url : null;
  if (!url) {
    return null;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : TRACE_URL_FALLBACK_BASE;
    return stripPortFromDeviceHost(new URL(url, base).host);
  } catch (error) {
    addLog(
      "debug",
      "Failed to resolve diagnostics trace transport host from URL",
      buildErrorLogDetails(error as Error, { url }),
    );
    return null;
  }
};

// F-DIAG-1 — Resolve the device-attribution host carried on the trace event's
// device-context snapshot. The previous implementation looked for a `host`
// field which DiagnosticsDeviceContext does not expose, so the fallback
// always returned null and unattributed events fell through to `return true`.
const resolveTraceAttributedHost = (event: TraceEvent<Record<string, unknown>>) => {
  const device = event.data.device;
  if (!device || typeof device !== "object") {
    return null;
  }
  const ctx = device as { savedDeviceHostSnapshot?: unknown; verifiedHostname?: unknown };
  const snapshotHost =
    typeof ctx.savedDeviceHostSnapshot === "string" && ctx.savedDeviceHostSnapshot.length > 0
      ? ctx.savedDeviceHostSnapshot
      : null;
  if (snapshotHost) return stripPortFromDeviceHost(snapshotHost);
  const verifiedHost =
    typeof ctx.verifiedHostname === "string" && ctx.verifiedHostname.length > 0 ? ctx.verifiedHostname : null;
  return verifiedHost ? stripPortFromDeviceHost(verifiedHost) : null;
};

const filterTraceEventsForConfiguredHost = (
  events: TraceEvent<Record<string, unknown>>[],
  configuredHost: string,
): TraceEvent<Record<string, unknown>>[] => {
  const selectedHost = stripPortFromDeviceHost(configuredHost);
  const correlationHosts = new Map<string, string>();

  events.forEach((event) => {
    const transportHost = resolveTraceTransportHost(event);
    if (transportHost) {
      correlationHosts.set(event.correlationId, transportHost);
    }
  });

  return events.filter((event) => {
    const transportHost = resolveTraceTransportHost(event);
    if (transportHost) {
      return transportHost === selectedHost;
    }

    const correlationHost = correlationHosts.get(event.correlationId) ?? null;
    if (correlationHost) {
      return correlationHost === selectedHost;
    }

    if (event.type === "error") {
      return false;
    }

    const attributedHost = resolveTraceAttributedHost(event);
    if (attributedHost) {
      return attributedHost === selectedHost;
    }

    return true;
  });
};

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
  const healthCheckState = useHealthCheckState();
  const savedDevices = useSavedDevices();
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
    const hostScopedTraceEvents = filterTraceEventsForConfiguredHost(traceEvents, host);
    const latestHealthCheck = healthCheckState.latestResult;
    const selectedSavedDevice =
      savedDevices.devices.find((device) => device.id === savedDevices.selectedDeviceId) ??
      savedDevices.devices[0] ??
      null;
    const connectedDeviceLabel = selectedSavedDevice
      ? buildSavedDevicePrimaryLabel(selectedSavedDevice)
      : inferConnectedDeviceLabel(deviceInfo?.product);

    if (latestHealthCheck) {
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
          lastRestActivity: deriveLastRestActivity(hostScopedTraceEvents),
          lastFtpActivity: deriveLastFtpActivity(hostScopedTraceEvents),
          lastTelnetActivity: deriveLastTelnetActivity(hostScopedTraceEvents),
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

    // Gate trace-derived health on having seen at least one successful REST response.
    // Before the first clean response, the badge stays Idle (connecting) rather than
    // flipping to Unhealthy from early probe failures or connection-retry noise.
    const hasFirstRestSuccess = hostScopedTraceEvents.some(
      (e) => e.type === "rest-response" && typeof e.data.status === "number" && e.data.status < 400,
    );

    const idleContributors = {
      App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      REST: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      TELNET: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    } as const;

    if (!hasFirstRestSuccess) {
      return {
        state: "Idle",
        connectivity,
        host,
        connectedDeviceLabel,
        problemCount: 0,
        contributors: idleContributors,
        lastRestActivity: deriveLastRestActivity(hostScopedTraceEvents),
        lastFtpActivity: deriveLastFtpActivity(hostScopedTraceEvents),
        lastTelnetActivity: deriveLastTelnetActivity(hostScopedTraceEvents),
        primaryProblem: null,
      };
    }

    // F-DIAG-1 — Defence in depth: the contributor functions also accept a
    // device scope, so even if a non-active-device event slips past the
    // host-name pre-filter above, it is excluded from the contributor rollup.
    const deviceScope: DeviceScope = {
      deviceId: selectedSavedDevice?.id ?? null,
      host,
    };
    const contributors = {
      App: deriveAppContributorHealth(hostScopedTraceEvents, deviceScope),
      REST: deriveRestContributorHealth(hostScopedTraceEvents, deviceScope),
      FTP: deriveFtpContributorHealth(hostScopedTraceEvents, deviceScope),
      TELNET: deriveTelnetContributorHealth(hostScopedTraceEvents, deviceScope),
    } as const;

    const state = rollUpHealth(contributors, connectivity);
    const totalProblems =
      contributors.App.problemCount +
      contributors.REST.problemCount +
      contributors.FTP.problemCount +
      contributors.TELNET.problemCount;

    return applyIdentityHealthGate(
      {
        state,
        connectivity,
        host,
        connectedDeviceLabel,
        problemCount: totalProblems,
        contributors,
        lastRestActivity: deriveLastRestActivity(hostScopedTraceEvents),
        lastFtpActivity: deriveLastFtpActivity(hostScopedTraceEvents),
        lastTelnetActivity: deriveLastTelnetActivity(hostScopedTraceEvents),
        primaryProblem: derivePrimaryProblem(hostScopedTraceEvents, contributors, deviceScope),
      },
      deviceInfo,
    );
  }, [
    connectionSnapshot.state,
    deviceInfo?.firmware_version,
    deviceInfo?.product,
    healthCheckState.latestResult,
    savedDevices,
    traceEvents,
  ]);
}
