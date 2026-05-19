/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HealthCheckRunResult } from "@/lib/diagnostics/healthCheckEngine";
import type { TraceEvent } from "@/lib/tracing/types";
import { inferConnectedDeviceLabel } from "@/lib/diagnostics/targetDisplayMapper";

// §7.1 — Health states (fixed labels, must not be paraphrased)
export type HealthState = "Healthy" | "Degraded" | "Unhealthy" | "Idle" | "Unavailable";

// §6.8 — Connectivity states (fixed labels)
export type ConnectivityState = "Online" | "Demo" | "Offline" | "Not yet connected" | "Checking";

export type DisplayProfile = "compact" | "medium" | "expanded";

// §6.3 — Health indicator contributors
export type ContributorKey = "App" | "REST" | "FTP" | "TELNET";

// §8.3 — Health glyphs (shape, color-independent)
export const HEALTH_GLYPHS: Record<HealthState, string> = {
  Healthy: "●",
  Degraded: "▲",
  Unhealthy: "◆",
  Idle: "○",
  Unavailable: "◌",
};

export const getBadgeConnectivityLabel = (connectivity: ConnectivityState, product?: string | null): string => {
  const connectedDeviceLabel = inferConnectedDeviceLabel(product) ?? "C64U";
  switch (connectivity) {
    case "Online":
      return connectedDeviceLabel;
    case "Demo":
      return "DEMO";
    case "Offline":
      return "Offline";
    case "Not yet connected":
      return "—";
    case "Checking":
      return connectedDeviceLabel;
  }
};

export const getBadgeHealthLabel = (health: HealthState, profile: DisplayProfile): string | null => {
  if (profile === "compact") {
    return null;
  }

  if (health === "Unavailable") {
    return profile === "medium" ? "?" : "Unavailable";
  }

  return health;
};

export type BadgeTextContract = {
  leadingLabel: string;
  glyph: string;
  countLabel: string | null;
  trailingLabel: string | null;
};

export const getBadgeVisibleProblemCount = (problemCount: number): string | null => {
  if (problemCount <= 0) {
    return null;
  }

  return problemCount > 999 ? "999+" : String(problemCount);
};

const getBadgeLeadingLabel = (
  connectivity: ConnectivityState,
  profile: DisplayProfile,
  product?: string | null,
  connectedDeviceLabel?: string | null,
) => {
  if (connectivity === "Not yet connected") {
    if (profile === "compact") {
      return "—";
    }

    return profile === "medium" ? "Not connected" : "Not yet connected";
  }

  if (connectivity === "Online" || connectivity === "Checking") {
    return connectedDeviceLabel ?? getBadgeConnectivityLabel(connectivity, product);
  }

  return getBadgeConnectivityLabel(connectivity, product);
};

export const getBadgeTextContract = (
  health: HealthState,
  connectivity: ConnectivityState,
  problemCount: number,
  profile: DisplayProfile,
  glyph: string,
  product?: string | null,
  connectedDeviceLabel?: string | null,
): BadgeTextContract => {
  const leadingLabel = getBadgeLeadingLabel(connectivity, profile, product, connectedDeviceLabel);

  if (connectivity === "Offline") {
    return {
      leadingLabel,
      glyph,
      countLabel: null,
      trailingLabel: profile === "expanded" ? "Device not reachable" : null,
    };
  }

  if (connectivity === "Not yet connected") {
    return {
      leadingLabel,
      glyph,
      countLabel: null,
      trailingLabel: null,
    };
  }

  const countLabel = getBadgeVisibleProblemCount(problemCount);
  const healthLabel = getBadgeHealthLabel(health, profile);

  if (profile === "compact") {
    return {
      leadingLabel,
      glyph,
      countLabel,
      trailingLabel: null,
    };
  }

  if (profile === "medium") {
    return {
      leadingLabel,
      glyph,
      countLabel,
      trailingLabel: healthLabel,
    };
  }

  const problemSuffix = countLabel ? `· ${countLabel} problem${problemCount === 1 ? "" : "s"}` : null;

  return {
    leadingLabel,
    glyph,
    countLabel: null,
    trailingLabel: [healthLabel, problemSuffix].filter(Boolean).join(" ") || null,
  };
};

export type LastActivity = {
  operation: string;
  result: string;
  timestampMs: number;
};

export type ContributorHealth = {
  state: HealthState;
  problemCount: number;
  totalOperations: number;
  failedOperations: number;
};

export type Problem = {
  id: string;
  title: string;
  contributor: ContributorKey;
  timestampMs: number;
  /** Higher number = higher impact. Unhealthy=2, Degraded=1 */
  impactLevel: number;
  causeHint: string | null;
};

export type OverallHealthState = {
  state: HealthState;
  connectivity: ConnectivityState;
  host: string;
  connectedDeviceLabel: string | null;
  problemCount: number;
  contributors: Record<ContributorKey, ContributorHealth>;
  lastRestActivity: LastActivity | null;
  lastFtpActivity: LastActivity | null;
  lastTelnetActivity: LastActivity | null;
  primaryProblem: Problem | null;
};

export type BadgeHealthSelection = Pick<OverallHealthState, "state" | "connectivity" | "problemCount">;

export type SelectedDeviceBadgeEvidence = {
  running: boolean;
  latestResult: Pick<HealthCheckRunResult, "overallHealth" | "connectivity" | "probes"> | null;
};

export const selectPreferredBadgeHealth = (
  base: BadgeHealthSelection,
  selectedEvidence: SelectedDeviceBadgeEvidence | null | undefined,
): BadgeHealthSelection => {
  const latestResult = selectedEvidence?.latestResult;
  if (!latestResult) {
    return base;
  }

  return {
    state: latestResult.overallHealth,
    connectivity: selectedEvidence?.running ? "Checking" : latestResult.connectivity,
    problemCount: Object.values(latestResult.probes).filter((probe) => probe.outcome === "Fail").length,
  };
};

// §7.2 — Map ConnectionState → ConnectivityState
export const deriveConnectivityState = (connectionState: string): ConnectivityState => {
  switch (connectionState) {
    case "REAL_CONNECTED":
      return "Online";
    case "DEMO_ACTIVE":
      return "Demo";
    case "OFFLINE_NO_DEMO":
      return "Offline";
    case "DISCOVERING":
      return "Checking";
    default:
      return "Not yet connected";
  }
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;
// F-DIAG-3 — recency window for App contributor severity.
// A single isolated error 4 minutes ago must not push the badge to Degraded;
// only errors within the last RECENT_APP_ERROR_WINDOW_MS contribute to severity.
const RECENT_APP_ERROR_WINDOW_MS = 60_000;
const APP_ERROR_UNHEALTHY_RECENT_THRESHOLD = 5;

// §7.3 — 5-minute current window
const isInCurrentWindow = (event: TraceEvent): boolean => {
  const eventMs = new Date(event.timestamp).getTime();
  return Date.now() - eventMs <= FIVE_MINUTES_MS;
};

const isInRecentAppErrorWindow = (event: TraceEvent): boolean => {
  const eventMs = new Date(event.timestamp).getTime();
  return Date.now() - eventMs <= RECENT_APP_ERROR_WINDOW_MS;
};

// F-DIAG-1 — Device scoping for contributor windows.
// Contributors compute per-active-device health. Saved-but-inactive devices'
// probe traffic must not degrade the active device's badge.
export type DeviceScope = {
  /** Saved device id of the currently active device, if known. */
  deviceId?: string | null;
  /** Hostname (or host:port) of the currently active device, if known. */
  host?: string | null;
};

const stripHostPort = (input: string): string => {
  const normalized = input.trim();
  if (!normalized) return normalized;
  if (normalized.startsWith("[")) {
    const closeBracketIndex = normalized.indexOf("]");
    if (closeBracketIndex !== -1) {
      return normalized.slice(0, closeBracketIndex + 1);
    }
  }
  const colonCount = (normalized.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const [host] = normalized.split(":");
    return host || normalized;
  }
  return normalized;
};

const readEventDeviceContext = (event: TraceEvent) => {
  const ctx = (event.data as { device?: unknown }).device;
  if (!ctx || typeof ctx !== "object") return null;
  return ctx as {
    savedDeviceId?: string | null;
    savedDeviceHostSnapshot?: string | null;
    verifiedHostname?: string | null;
  };
};

const readEventTransportHost = (event: TraceEvent): string | null => {
  const data = event.data as { hostname?: unknown; url?: unknown };
  if (typeof data.hostname === "string" && data.hostname.length > 0) {
    return stripHostPort(data.hostname);
  }
  if (typeof data.url === "string" && data.url.length > 0) {
    try {
      const parsed = new URL(data.url, "http://localhost");
      if (parsed.host) return stripHostPort(parsed.host);
    } catch {
      // ignore malformed URL — fall through to device attribution
    }
  }
  return null;
};

// Returns true when the event should be counted toward the given scope.
// Transport events (REST/FTP/Telnet) match by hostname authoritatively because
// the device context snapshot is GLOBAL — saved-device probes inherit the
// active device's attribution even though they target a different host.
// Events without a transport hostname (e.g. errors, lifecycle events) fall
// back to the captured device attribution; if neither matches, the event is
// dropped for device-scoped contributors.
export const eventMatchesDeviceScope = (event: TraceEvent, scope: DeviceScope | null | undefined): boolean => {
  if (!scope) return true;
  const targetDeviceId = typeof scope.deviceId === "string" && scope.deviceId.length > 0 ? scope.deviceId : null;
  const targetHost = typeof scope.host === "string" && scope.host.length > 0 ? stripHostPort(scope.host) : null;
  if (!targetDeviceId && !targetHost) return true;

  const transportHost = readEventTransportHost(event);
  if (transportHost) {
    // Transport events: hostname is authoritative.
    return targetHost !== null && transportHost === targetHost;
  }

  const deviceCtx = readEventDeviceContext(event);
  if (!deviceCtx) return false;

  if (targetDeviceId && typeof deviceCtx.savedDeviceId === "string" && deviceCtx.savedDeviceId === targetDeviceId) {
    return true;
  }
  if (targetHost) {
    if (typeof deviceCtx.savedDeviceHostSnapshot === "string") {
      const snapshotHost = stripHostPort(deviceCtx.savedDeviceHostSnapshot);
      if (snapshotHost && snapshotHost === targetHost) return true;
    }
    if (typeof deviceCtx.verifiedHostname === "string") {
      const verifiedHost = stripHostPort(deviceCtx.verifiedHostname);
      if (verifiedHost && verifiedHost === targetHost) return true;
    }
  }
  return false;
};

const scopeEvents = (events: TraceEvent[], scope: DeviceScope | null | undefined): TraceEvent[] => {
  if (!scope) return events;
  return events.filter((event) => eventMatchesDeviceScope(event, scope));
};

// Derive health state from fail ratio
const healthFromRatio = (failed: number, total: number): HealthState => {
  if (total === 0) return "Idle";
  if (failed === 0) return "Healthy";
  const ratio = failed / total;
  if (ratio >= 0.5) return "Unhealthy";
  if (ratio >= 0.2) return "Degraded";
  return "Healthy";
};

const isExpectedTraceFailure = (event: TraceEvent): boolean => event.data.expectedFailure === true;

export const isExpectedCancellationFailure = (event: TraceEvent): boolean => {
  const values = [event.data.error, event.data.message, event.data.reason]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  return values.some(
    (value) =>
      value.includes("abort") ||
      value.includes("cancelled") ||
      value.includes("canceled") ||
      value.includes("superseded by a new"),
  );
};

const isExpectedNonDiagnosticFailure = (event: TraceEvent): boolean =>
  isExpectedTraceFailure(event) || isExpectedCancellationFailure(event);

const isSuccessfulRestResponse = (event: TraceEvent): boolean => {
  const status = typeof event.data.status === "number" ? event.data.status : null;
  const hasError = typeof event.data.error === "string" && event.data.error.trim().length > 0;
  return status !== null && status < 400 && !hasError;
};

const isSuccessfulFtpOperation = (event: TraceEvent): boolean => {
  const result = typeof event.data.result === "string" ? event.data.result : null;
  const hasError = typeof event.data.error === "string" && event.data.error.trim().length > 0;
  return result === "success" && !hasError;
};

const isSuccessfulTelnetOperation = (event: TraceEvent): boolean => {
  const result = typeof event.data.result === "string" ? event.data.result : null;
  const hasError = typeof event.data.error === "string" && event.data.error.trim().length > 0;
  return result === "success" && !hasError;
};

const sortEventsByTimestampAscending = (events: TraceEvent[]): TraceEvent[] =>
  [...events].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

const trimToLatestSuccess = (events: TraceEvent[], isSuccess: (event: TraceEvent) => boolean): TraceEvent[] => {
  const latestSuccessIndex = events.findLastIndex(isSuccess);
  return latestSuccessIndex >= 0 ? events.slice(latestSuccessIndex) : events;
};

// F-DIAG-2 — REST window trim policy mirrors FTP/TELNET (`trimToLatestSuccess`).
// Sort events by ascending timestamp, then drop everything before the latest
// successful response. Recovery latency must match the other contributors so
// the user never sees "FTP green / REST red" minutes after the same outage cleared.
const restHealthWindowEvents = (events: TraceEvent[]): TraceEvent[] => {
  const windowEvents = sortEventsByTimestampAscending(
    events.filter((e) => e.type === "rest-response" && isInCurrentWindow(e)),
  );
  return trimToLatestSuccess(windowEvents, isSuccessfulRestResponse);
};

const ftpHealthWindowEvents = (events: TraceEvent[]): TraceEvent[] => {
  const windowEvents = sortEventsByTimestampAscending(
    events.filter((e) => e.type === "ftp-operation" && isInCurrentWindow(e)),
  );
  return trimToLatestSuccess(windowEvents, isSuccessfulFtpOperation);
};

const telnetHealthWindowEvents = (events: TraceEvent[]): TraceEvent[] => {
  const windowEvents = sortEventsByTimestampAscending(
    events.filter((e) => e.type === "telnet-operation" && isInCurrentWindow(e)),
  );
  return trimToLatestSuccess(windowEvents, isSuccessfulTelnetOperation);
};

const isPreConnectionGatingError = (event: TraceEvent): boolean =>
  typeof event.data.message === "string" && /device not ready for requests/i.test(event.data.message);

// §6.3 — REST contributor health from trace events in 5-minute window
export const deriveRestContributorHealth = (events: TraceEvent[], scope?: DeviceScope | null): ContributorHealth => {
  const scopedEvents = scopeEvents(events, scope);
  const windowEvents = restHealthWindowEvents(scopedEvents);
  let failed = 0;
  for (const e of windowEvents) {
    if (isExpectedNonDiagnosticFailure(e)) continue;
    const status = typeof e.data.status === "number" ? e.data.status : null;
    const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
    if ((status !== null && status >= 400) || hasError) failed += 1;
  }
  const total = windowEvents.filter((event) => !isExpectedNonDiagnosticFailure(event)).length;
  return {
    state: healthFromRatio(failed, total),
    problemCount: failed,
    totalOperations: total,
    failedOperations: failed,
  };
};

// §6.3 — FTP contributor health from trace events in 5-minute window
export const deriveFtpContributorHealth = (events: TraceEvent[], scope?: DeviceScope | null): ContributorHealth => {
  const scopedEvents = scopeEvents(events, scope);
  const windowEvents = ftpHealthWindowEvents(scopedEvents);
  let failed = 0;
  for (const e of windowEvents) {
    if (isExpectedNonDiagnosticFailure(e)) continue;
    const result = typeof e.data.result === "string" ? e.data.result : null;
    const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
    if (result === "failure" || hasError) failed += 1;
  }
  const total = windowEvents.filter((event) => !isExpectedNonDiagnosticFailure(event)).length;
  return {
    state: healthFromRatio(failed, total),
    problemCount: failed,
    totalOperations: total,
    failedOperations: failed,
  };
};

// §6.3 — Telnet contributor health from trace events in 5-minute window
export const deriveTelnetContributorHealth = (events: TraceEvent[], scope?: DeviceScope | null): ContributorHealth => {
  const scopedEvents = scopeEvents(events, scope);
  const windowEvents = telnetHealthWindowEvents(scopedEvents);
  let failed = 0;
  for (const event of windowEvents) {
    if (isExpectedNonDiagnosticFailure(event)) continue;
    const result = typeof event.data.result === "string" ? event.data.result : null;
    const hasError = typeof event.data.error === "string" && event.data.error.trim().length > 0;
    if (result === "failure" || hasError) failed += 1;
  }
  const total = windowEvents.filter((event) => !isExpectedNonDiagnosticFailure(event)).length;
  return {
    state: healthFromRatio(failed, total),
    problemCount: failed,
    totalOperations: total,
    failedOperations: failed,
  };
};

// §6.3 — App contributor health from error trace events in 5-minute window.
// F-DIAG-3 — Severity is driven by RECENT errors (last 60 s) rather than the
// whole 5-minute window so a single isolated error 4 minutes ago does not
// keep the badge in Degraded.
export const deriveAppContributorHealth = (events: TraceEvent[], scope?: DeviceScope | null): ContributorHealth => {
  const scopedEvents = scopeEvents(events, scope);
  const windowEvents = scopedEvents.filter(
    (e) =>
      e.type === "error" &&
      isInCurrentWindow(e) &&
      e.data.isExpected !== true &&
      !isExpectedCancellationFailure(e) &&
      !isPreConnectionGatingError(e),
  );
  const total = windowEvents.length;
  const recent = windowEvents.filter(isInRecentAppErrorWindow).length;
  let state: HealthState;
  if (recent >= APP_ERROR_UNHEALTHY_RECENT_THRESHOLD) {
    state = "Unhealthy";
  } else if (recent >= 1) {
    state = "Degraded";
  } else {
    state = "Idle";
  }
  return { state, problemCount: total, totalOperations: total, failedOperations: total };
};

// §7.4 — Overall health roll-up (worst-contributor-wins)
export const rollUpHealth = (
  contributors: Record<ContributorKey, ContributorHealth>,
  connectivity: ConnectivityState,
): HealthState => {
  // §7.2 — Offline overrides health to Unavailable
  if (connectivity === "Offline") return "Unavailable";
  // §7.5 — Not yet connected → Idle
  if (connectivity === "Not yet connected") return "Idle";

  const states = Object.values(contributors).map((c) => c.state);
  if (states.some((s) => s === "Unavailable")) return "Unavailable";
  if (states.some((s) => s === "Unhealthy")) return "Unhealthy";
  if (states.some((s) => s === "Degraded")) return "Degraded";
  if (states.some((s) => s === "Healthy")) return "Healthy";
  return "Idle";
};

// §10.5 — Last REST activity from trace events
export const deriveLastRestActivity = (events: TraceEvent[]): LastActivity | null => {
  const restEvents = events.filter((e) => e.type === "rest-response");
  if (restEvents.length === 0) return null;
  const last = restEvents[restEvents.length - 1];
  const method = typeof last.data.method === "string" ? last.data.method : "REST";
  const path = typeof last.data.path === "string" ? last.data.path : "";
  const url = typeof last.data.url === "string" ? last.data.url : "";
  const status = typeof last.data.status === "number" ? String(last.data.status) : "unknown";
  const operation = `${method} ${path || url}`.trim().slice(0, 40) || "REST request";
  return { operation, result: status, timestampMs: new Date(last.timestamp).getTime() };
};

// §10.5 — Last FTP activity from trace events
export const deriveLastFtpActivity = (events: TraceEvent[]): LastActivity | null => {
  const ftpEvents = events.filter((e) => e.type === "ftp-operation");
  if (ftpEvents.length === 0) return null;
  const last = ftpEvents[ftpEvents.length - 1];
  const op = typeof last.data.operation === "string" ? last.data.operation : "FTP";
  const path = typeof last.data.path === "string" ? last.data.path : "";
  const result = typeof last.data.result === "string" ? last.data.result : "ok";
  const operation = `${op} ${path}`.trim().slice(0, 40) || "FTP operation";
  return { operation, result, timestampMs: new Date(last.timestamp).getTime() };
};

// §10.5 — Last Telnet activity from trace events
export const deriveLastTelnetActivity = (events: TraceEvent[]): LastActivity | null => {
  const telnetEvents = events.filter((e) => e.type === "telnet-operation");
  if (telnetEvents.length === 0) return null;
  const last = telnetEvents[telnetEvents.length - 1];
  const actionLabel = typeof last.data.actionLabel === "string" ? last.data.actionLabel : "Telnet action";
  const result = typeof last.data.result === "string" ? last.data.result : "unknown";
  return {
    operation: actionLabel.slice(0, 40),
    result,
    timestampMs: new Date(last.timestamp).getTime(),
  };
};

// §7.6 — Primary problem selection (highest impact → most recent)
export const derivePrimaryProblem = (
  events: TraceEvent[],
  contributors: Record<ContributorKey, ContributorHealth>,
  scope?: DeviceScope | null,
): Problem | null => {
  const scopedEvents = scopeEvents(events, scope);
  const problems: Problem[] = [];
  const restHealthEvents = new Set(restHealthWindowEvents(scopedEvents));
  const ftpHealthEvents = new Set(ftpHealthWindowEvents(scopedEvents));
  const telnetHealthEvents = new Set(telnetHealthWindowEvents(scopedEvents));

  // Collect failed REST responses as Problems
  for (const e of scopedEvents) {
    if (e.type === "rest-response") {
      if (!restHealthEvents.has(e)) continue;
      if (isExpectedNonDiagnosticFailure(e)) continue;
      const status = typeof e.data.status === "number" ? e.data.status : null;
      const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
      if ((status !== null && status >= 400) || hasError) {
        const method = typeof e.data.method === "string" ? e.data.method : "REST";
        const path = typeof e.data.path === "string" ? e.data.path : "";
        const causeHint = hasError ? String(e.data.error).slice(0, 40) : status ? `HTTP ${status}` : null;
        problems.push({
          id: e.id,
          title: `${method} ${path} failed`.trim().slice(0, 80),
          contributor: "REST",
          timestampMs: new Date(e.timestamp).getTime(),
          impactLevel: contributors.REST.state === "Unhealthy" ? 2 : 1,
          causeHint,
        });
      }
    } else if (e.type === "ftp-operation") {
      if (!ftpHealthEvents.has(e)) continue;
      if (isExpectedNonDiagnosticFailure(e)) continue;
      const result = typeof e.data.result === "string" ? e.data.result : null;
      const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
      if (result === "failure" || hasError) {
        const op = typeof e.data.operation === "string" ? e.data.operation : "FTP";
        const path = typeof e.data.path === "string" ? e.data.path : "";
        problems.push({
          id: e.id,
          title: `${op} ${path} failed`.trim().slice(0, 80),
          contributor: "FTP",
          timestampMs: new Date(e.timestamp).getTime(),
          impactLevel: contributors.FTP.state === "Unhealthy" ? 2 : 1,
          causeHint: hasError ? String(e.data.error).slice(0, 40) : null,
        });
      }
    } else if (e.type === "telnet-operation") {
      if (!telnetHealthEvents.has(e)) continue;
      if (isExpectedNonDiagnosticFailure(e)) continue;
      const result = typeof e.data.result === "string" ? e.data.result : null;
      const hasError = typeof e.data.error === "string" && e.data.error.trim().length > 0;
      if (result === "failure" || hasError) {
        const actionLabel = typeof e.data.actionLabel === "string" ? e.data.actionLabel : "Telnet action";
        problems.push({
          id: e.id,
          title: `${actionLabel} failed`.slice(0, 80),
          contributor: "TELNET",
          timestampMs: new Date(e.timestamp).getTime(),
          impactLevel: contributors.TELNET.state === "Unhealthy" ? 2 : 1,
          causeHint: hasError ? String(e.data.error).slice(0, 40) : null,
        });
      }
    } else if (e.type === "error") {
      if (isPreConnectionGatingError(e) || e.data.isExpected === true || isExpectedCancellationFailure(e)) continue;
      const message = typeof e.data.message === "string" ? e.data.message : "Application error";
      problems.push({
        id: e.id,
        title: message.slice(0, 80),
        contributor: "App",
        timestampMs: new Date(e.timestamp).getTime(),
        impactLevel: contributors.App.state === "Unhealthy" ? 2 : 1,
        causeHint: null,
      });
    }
  }

  if (problems.length === 0) return null;

  // Sort: highest impact first, then most recent
  problems.sort((a, b) => {
    if (b.impactLevel !== a.impactLevel) return b.impactLevel - a.impactLevel;
    return b.timestampMs - a.timestampMs;
  });
  return problems[0];
};

// §8.4–8.8 — Badge label text for a given profile
export const getBadgeLabel = (
  health: HealthState,
  connectivity: ConnectivityState,
  problemCount: number,
  profile: DisplayProfile,
  glyph: string,
  product?: string | null,
  connectedDeviceLabel?: string | null,
): string => {
  const badgeText = getBadgeTextContract(
    health,
    connectivity,
    problemCount,
    profile,
    glyph,
    product,
    connectedDeviceLabel,
  );

  return [badgeText.leadingLabel, badgeText.glyph, badgeText.countLabel, badgeText.trailingLabel]
    .filter((part): part is string => Boolean(part))
    .join(" ");
};

// §8.5 — aria-label
export const getBadgeAriaLabel = (
  health: HealthState,
  connectivity: ConnectivityState,
  problemCount: number,
  product?: string | null,
  connectedDeviceLabel?: string | null,
): string => {
  if (connectivity === "Offline") return "Offline, device not reachable";
  if (connectivity === "Not yet connected") return "Not yet connected";
  const connPhrase =
    connectivity === "Online" || connectivity === "Checking"
      ? `Connected to ${connectedDeviceLabel ?? inferConnectedDeviceLabel(product) ?? "C64U"}`
      : "Demo mode";
  switch (health) {
    case "Healthy":
      return `${connPhrase}, system healthy`;
    case "Degraded":
      return `${connPhrase}, system degraded, ${problemCount} problem${problemCount !== 1 ? "s" : ""}`;
    case "Unhealthy":
      return `${connPhrase}, system unhealthy, ${problemCount} problem${problemCount !== 1 ? "s" : ""}`;
    case "Idle":
      return `${connPhrase}, idle`;
    case "Unavailable":
      return `${connPhrase}, diagnostics unavailable`;
  }
};

// §10.6 — Supporting phrase for contributor rows
export const getContributorSupportingPhrase = (contributor: ContributorKey, health: ContributorHealth): string => {
  if (health.state === "Idle") return "Idle";
  if (contributor === "App") {
    const n = health.problemCount;
    return n === 1 ? "1 recent problem" : `${n} recent problems`;
  }
  const { totalOperations: total, failedOperations: failed } = health;
  if (contributor === "REST") {
    return `${total} request${total !== 1 ? "s" : ""}, ${failed} failed`;
  }
  if (contributor === "TELNET") {
    return `${total} action${total !== 1 ? "s" : ""}, ${failed} failed`;
  }
  return `${total} operation${total !== 1 ? "s" : ""}, ${failed} failed`;
};
