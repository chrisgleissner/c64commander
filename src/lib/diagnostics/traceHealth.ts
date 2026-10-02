/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TraceEvent } from "@/lib/tracing/types";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import type { HealthCheckRunResult } from "@/lib/diagnostics/healthCheckEngine";
import {
  type ContributorHealth,
  type ContributorKey,
  type DeviceScope,
  type LastActivity,
  type Problem,
  deriveAppContributorHealth,
  deriveFtpContributorHealth,
  deriveLastFtpActivity,
  deriveLastRestActivity,
  deriveLastTelnetActivity,
  derivePrimaryProblem,
  deriveRestContributorHealth,
  deriveTelnetContributorHealth,
} from "@/lib/diagnostics/healthModel";
import { selectHealthWindowEvents } from "@/lib/diagnostics/healthTraceWindow";
import { addLog, buildErrorLogDetails } from "@/lib/logging";

type HealthTraceEvent = TraceEvent<Record<string, unknown>>;

const TRACE_URL_FALLBACK_BASE = "http://localhost";
// A full rebuild resets the correlation map; this only bounds its growth over a very long session.
const MAX_INDEXED_CORRELATIONS = 50_000;

const transportHostCache = new WeakMap<HealthTraceEvent, string | null>();

const parseTraceTransportHost = (event: HealthTraceEvent) => {
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

const resolveTraceTransportHost = (event: HealthTraceEvent) => {
  if (transportHostCache.has(event)) return transportHostCache.get(event) ?? null;
  const host = parseTraceTransportHost(event);
  transportHostCache.set(event, host);
  return host;
};

// F-DIAG-1 — the device-attribution host lives on the event's DiagnosticsDeviceContext snapshot.
const resolveTraceAttributedHost = (event: HealthTraceEvent) => {
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

const matchesSelectedHost = (
  event: HealthTraceEvent,
  selectedHost: string,
  correlationHostOf: (correlationId: string) => string | null,
) => {
  const transportHost = resolveTraceTransportHost(event);
  if (transportHost) {
    return transportHost === selectedHost;
  }

  const correlationHost = correlationHostOf(event.correlationId);
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
};

/**
 * Keeps the events that belong to the configured host. An event without a transport host takes the
 * host of another event in its correlation: one in `events` first, then one the caller already saw
 * in older events (`olderCorrelationHosts`).
 */
export const filterTraceEventsForConfiguredHost = <T extends HealthTraceEvent>(
  events: readonly T[],
  configuredHost: string,
  olderCorrelationHosts?: ReadonlyMap<string, string>,
): T[] => {
  const selectedHost = stripPortFromDeviceHost(configuredHost);
  const correlationHosts = new Map<string, string>();
  events.forEach((event) => {
    const transportHost = resolveTraceTransportHost(event);
    if (transportHost) {
      correlationHosts.set(event.correlationId, transportHost);
    }
  });
  const correlationHostOf = (correlationId: string) =>
    correlationHosts.get(correlationId) ?? olderCorrelationHosts?.get(correlationId) ?? null;
  return events.filter((event) => matchesSelectedHost(event, selectedHost, correlationHostOf));
};

const hasErrorText = (event: HealthTraceEvent) =>
  typeof event.data.error === "string" && event.data.error.trim().length > 0;

const isRestResponseBelow400 = (event: HealthTraceEvent) =>
  event.type === "rest-response" && typeof event.data.status === "number" && event.data.status < 400;

const isFailureEvidence = (event: HealthTraceEvent) => {
  if (event.type === "error") return event.data.isExpected !== true;
  if (event.type === "rest-response") return typeof event.data.status === "number" && event.data.status >= 400;
  if (event.type === "ftp-operation" || event.type === "telnet-operation") {
    return event.data.result === "failure" || hasErrorText(event);
  }
  return false;
};

const isSuccessEvidence = (event: HealthTraceEvent) => {
  if (event.type === "rest-response") return isRestResponseBelow400(event);
  if (event.type === "ftp-operation" || event.type === "telnet-operation") {
    return event.data.result === "success" && !hasErrorText(event);
  }
  return false;
};

type HealthTraceFacts = {
  lastRest: HealthTraceEvent | null;
  lastFtp: HealthTraceEvent | null;
  lastTelnet: HealthTraceEvent | null;
  lastRestBelow400: HealthTraceEvent | null;
  newestFailureEvidence: HealthTraceEvent | null;
  newestSuccessEvidence: HealthTraceEvent | null;
};

const emptyFacts = (): HealthTraceFacts => ({
  lastRest: null,
  lastFtp: null,
  lastTelnet: null,
  lastRestBelow400: null,
  newestFailureEvidence: null,
  newestSuccessEvidence: null,
});

/**
 * Host-scoped facts that health reads from the whole trace store, not just the current window: the
 * latest REST/FTP/Telnet activity, whether REST ever answered, and the newest evidence for or
 * against a pinned health-check verdict. Each update reads only the events appended since the
 * previous one. The store evicts from its oldest end, so a fact whose event was evicted had no
 * younger event of its kind and reads as absent.
 */
export type HealthTraceIndex = {
  host: string | null;
  anchor: HealthTraceEvent | null;
  sequence: WeakMap<HealthTraceEvent, number>;
  nextSequence: number;
  correlationHosts: Map<string, string>;
  facts: HealthTraceFacts;
};

export const createHealthTraceIndex = (): HealthTraceIndex => ({
  host: null,
  anchor: null,
  sequence: new WeakMap(),
  nextSequence: 0,
  correlationHosts: new Map(),
  facts: emptyFacts(),
});

const resetIndex = (index: HealthTraceIndex, host: string) => {
  index.host = host;
  index.anchor = null;
  index.sequence = new WeakMap();
  index.nextSequence = 0;
  index.correlationHosts = new Map();
  index.facts = emptyFacts();
};

const findFirstUnindexedPosition = (index: HealthTraceIndex, events: readonly HealthTraceEvent[]) => {
  if (!index.anchor || !index.sequence.has(events[0])) return null;
  for (let position = events.length - 1; position >= 0; position -= 1) {
    if (events[position] === index.anchor) return position + 1;
    if (index.sequence.has(events[position])) return null;
  }
  return null;
};

const timestampMs = (event: HealthTraceEvent | null) => (event ? Date.parse(event.timestamp) : Number.NaN);

const isNewerEvidence = (candidate: HealthTraceEvent, current: HealthTraceEvent | null) => {
  if (current === null) return true;
  const candidateMs = Date.parse(candidate.timestamp);
  return Number.isNaN(timestampMs(current)) || candidateMs >= timestampMs(current);
};

const indexEvent = (index: HealthTraceIndex, event: HealthTraceEvent, selectedHost: string) => {
  index.sequence.set(event, index.nextSequence);
  index.nextSequence += 1;
  const transportHost = resolveTraceTransportHost(event);
  if (transportHost) {
    index.correlationHosts.set(event.correlationId, transportHost);
  }
  if (!matchesSelectedHost(event, selectedHost, (id) => index.correlationHosts.get(id) ?? null)) return;
  const facts = index.facts;
  if (event.type === "rest-response") facts.lastRest = event;
  if (event.type === "ftp-operation") facts.lastFtp = event;
  if (event.type === "telnet-operation") facts.lastTelnet = event;
  if (isRestResponseBelow400(event)) facts.lastRestBelow400 = event;
  if (isFailureEvidence(event) && isNewerEvidence(event, facts.newestFailureEvidence)) {
    facts.newestFailureEvidence = event;
  }
  if (isSuccessEvidence(event) && isNewerEvidence(event, facts.newestSuccessEvidence)) {
    facts.newestSuccessEvidence = event;
  }
};

export const updateHealthTraceIndex = (
  index: HealthTraceIndex,
  events: readonly HealthTraceEvent[],
  configuredHost: string,
): HealthTraceFacts => {
  const selectedHost = stripPortFromDeviceHost(configuredHost);
  if (events.length === 0) {
    resetIndex(index, selectedHost);
    return index.facts;
  }
  let start =
    index.host === selectedHost && index.correlationHosts.size <= MAX_INDEXED_CORRELATIONS
      ? findFirstUnindexedPosition(index, events)
      : null;
  if (start === null) {
    resetIndex(index, selectedHost);
    start = 0;
  }
  for (let position = start; position < events.length; position += 1) {
    indexEvent(index, events[position], selectedHost);
  }
  index.anchor = events[events.length - 1];

  const oldestRetained = index.sequence.get(events[0]) ?? 0;
  const retained = (event: HealthTraceEvent | null) =>
    event !== null && (index.sequence.get(event) ?? -1) >= oldestRetained ? event : null;
  const facts = index.facts;
  return {
    lastRest: retained(facts.lastRest),
    lastFtp: retained(facts.lastFtp),
    lastTelnet: retained(facts.lastTelnet),
    lastRestBelow400: retained(facts.lastRestBelow400),
    newestFailureEvidence: retained(facts.newestFailureEvidence),
    newestSuccessEvidence: retained(facts.newestSuccessEvidence),
  };
};

export type PinnedHealthCheck = Pick<HealthCheckRunResult, "overallHealth" | "endTimestamp" | "probes">;

export type TraceHealthInput = {
  events: readonly HealthTraceEvent[];
  host: string;
  deviceId: string | null;
  latestHealthCheck: PinnedHealthCheck | null;
  nowMs: number;
};

type LastActivities = {
  lastRestActivity: LastActivity | null;
  lastFtpActivity: LastActivity | null;
  lastTelnetActivity: LastActivity | null;
};

export type TraceHealth =
  | ({ kind: "pinned-health-check" } & LastActivities)
  | ({ kind: "awaiting-first-rest-success" } & LastActivities)
  | ({
      kind: "trace-derived";
      contributors: Record<ContributorKey, ContributorHealth>;
      primaryProblem: Problem | null;
    } & LastActivities);

// HARD19-004 (D1): live evidence newer than a pinned verdict overrides it — failures after a Healthy
// check, successes after any other result.
const isPinnedVerdictContradicted = (latestHealthCheck: PinnedHealthCheck | null, facts: HealthTraceFacts) => {
  if (!latestHealthCheck) return false;
  const pinnedEndMs = new Date(latestHealthCheck.endTimestamp).getTime();
  if (Number.isNaN(pinnedEndMs)) return false;
  const evidence =
    latestHealthCheck.overallHealth === "Healthy" ? facts.newestFailureEvidence : facts.newestSuccessEvidence;
  return timestampMs(evidence) > pinnedEndMs;
};

const asList = (event: HealthTraceEvent | null) => (event ? [event] : []);

/**
 * The trace-dependent part of the health state. Whole-store facts come from `index`, which advances
 * by the newly appended events; the windowed contributor rules see only the events inside the
 * current health window, so the cost of a call does not grow with the age of the session.
 */
export const deriveTraceHealth = (input: TraceHealthInput, index: HealthTraceIndex): TraceHealth => {
  const facts = updateHealthTraceIndex(index, input.events, input.host);
  const lastActivities: LastActivities = {
    lastRestActivity: deriveLastRestActivity(asList(facts.lastRest)),
    lastFtpActivity: deriveLastFtpActivity(asList(facts.lastFtp)),
    lastTelnetActivity: deriveLastTelnetActivity(asList(facts.lastTelnet)),
  };

  const latestHealthCheck = input.latestHealthCheck;
  if (latestHealthCheck && !isPinnedVerdictContradicted(latestHealthCheck, facts)) {
    return { kind: "pinned-health-check", ...lastActivities };
  }

  // Before the first clean REST response the badge stays Idle (connecting) rather than flipping to
  // Unhealthy from early probe failures or connection-retry noise.
  const hasFirstRestSuccess = facts.lastRestBelow400 !== null || latestHealthCheck?.probes.REST.outcome === "Success";
  if (!hasFirstRestSuccess) {
    return { kind: "awaiting-first-rest-success", ...lastActivities };
  }

  const windowEvents = filterTraceEventsForConfiguredHost(
    selectHealthWindowEvents(input.events, input.nowMs),
    input.host,
    index.correlationHosts,
  );
  // F-DIAG-1 — the contributors also apply the device scope, so an event that slipped past the host
  // filter still cannot count toward the active device.
  const deviceScope: DeviceScope = { deviceId: input.deviceId, host: input.host };
  const contributors = {
    App: deriveAppContributorHealth(windowEvents, deviceScope),
    REST: deriveRestContributorHealth(windowEvents, deviceScope),
    FTP: deriveFtpContributorHealth(windowEvents, deviceScope),
    TELNET: deriveTelnetContributorHealth(windowEvents, deviceScope),
  };
  return {
    kind: "trace-derived",
    ...lastActivities,
    contributors,
    primaryProblem: derivePrimaryProblem(windowEvents, contributors, deviceScope),
  };
};
