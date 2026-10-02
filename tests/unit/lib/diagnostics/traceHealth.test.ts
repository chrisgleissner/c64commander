import { describe, expect, it } from "vitest";
import {
  deriveAppContributorHealth,
  deriveFtpContributorHealth,
  deriveLastFtpActivity,
  deriveLastRestActivity,
  deriveLastTelnetActivity,
  derivePrimaryProblem,
  deriveRestContributorHealth,
  deriveTelnetContributorHealth,
} from "@/lib/diagnostics/healthModel";
import { HEALTH_CURRENT_WINDOW_MS, selectHealthWindowEvents } from "@/lib/diagnostics/healthTraceWindow";
import { createHealthTraceIndex, deriveTraceHealth } from "@/lib/diagnostics/traceHealth";
import type { TraceEvent } from "@/lib/tracing/types";

const NOW_MS = Date.now();
let eventCounter = 0;

const traceEvent = (type: string, ageMs: number, data: Record<string, unknown>, correlationId?: string): TraceEvent => {
  eventCounter += 1;
  return {
    id: `EVT-${eventCounter}`,
    timestamp: new Date(NOW_MS - ageMs).toISOString(),
    relativeMs: eventCounter,
    type,
    origin: "user",
    correlationId: correlationId ?? `COR-${eventCounter}`,
    data,
  } as TraceEvent;
};

const oldSession = (count: number) => {
  const events: TraceEvent[] = [
    traceEvent("telnet-operation", 20 * 60_000, { actionLabel: "Reset C64", result: "success", hostname: "c64u" }),
  ];
  for (let index = 0; index < count; index += 1) {
    const ageMs = 20 * 60_000 - index * 30;
    events.push(
      index % 50 === 0
        ? traceEvent("rest-response", ageMs, { method: "GET", path: "/v1/configs", status: 500, hostname: "c64u" })
        : traceEvent("rest-response", ageMs, { method: "GET", path: "/v1/info", status: 200, hostname: "c64u" }),
    );
  }
  return events;
};

const recentFailures = () => [
  traceEvent("rest-response", 40_000, { method: "GET", path: "/v1/info", status: 200, hostname: "c64u" }),
  traceEvent("rest-response", 20_000, { method: "PUT", path: "/v1/machine:reset", status: 503, hostname: "c64u" }, "R"),
  traceEvent("error", 19_000, { message: "Reset failed", isExpected: false }, "R"),
  traceEvent("ftp-operation", 10_000, { operation: "list", path: "/Usb0", result: "success", hostname: "c64u" }),
];

const countIndexReads = <T>(events: T[]) => {
  const reads = { count: 0 };
  const proxy = new Proxy(events, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) reads.count += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  return { proxy, reads };
};

const fullScanOutcome = (events: TraceEvent[]) => {
  const scope = { deviceId: null, host: "c64u" };
  const contributors = {
    App: deriveAppContributorHealth(events, scope),
    REST: deriveRestContributorHealth(events, scope),
    FTP: deriveFtpContributorHealth(events, scope),
    TELNET: deriveTelnetContributorHealth(events, scope),
  };
  return {
    kind: "trace-derived",
    lastRestActivity: deriveLastRestActivity(events),
    lastFtpActivity: deriveLastFtpActivity(events),
    lastTelnetActivity: deriveLastTelnetActivity(events),
    contributors,
    primaryProblem: derivePrimaryProblem(events, contributors, scope),
  };
};

const input = (events: readonly TraceEvent[]) => ({
  events,
  host: "c64u",
  deviceId: null,
  latestHealthCheck: null,
  nowMs: Date.now(),
});

describe("selectHealthWindowEvents", () => {
  it("stops scanning at the first event older than the health window", () => {
    const recent = recentFailures();
    const { proxy, reads } = countIndexReads([...oldSession(20_000), ...recent]);

    const windowEvents = selectHealthWindowEvents(proxy, NOW_MS);

    expect(windowEvents).toEqual(recent);
    expect(reads.count).toBeLessThanOrEqual(2 * recent.length + 1);
  });

  it("keeps an event exactly at the edge of the window", () => {
    const edge = traceEvent("error", HEALTH_CURRENT_WINDOW_MS, { message: "edge" });
    const older = traceEvent("error", HEALTH_CURRENT_WINDOW_MS + 1, { message: "older" });

    expect(selectHealthWindowEvents([older, edge], NOW_MS)).toEqual([edge]);
  });
});

describe("deriveTraceHealth", () => {
  it("matches a full scan of the store while visiting only the newly appended events", () => {
    const index = createHealthTraceIndex();
    const history = oldSession(20_000);
    deriveTraceHealth(input(history), index);

    const events = [...history, ...recentFailures()];
    const { proxy, reads } = countIndexReads(events);
    const health = deriveTraceHealth(input(proxy), index);

    expect(reads.count).toBeLessThan(40);
    expect(health).toEqual(fullScanOutcome(events));
    expect(health.kind === "trace-derived" && health.contributors.REST.failedOperations).toBe(1);
    expect(health.lastTelnetActivity?.operation).toBe("Reset C64");
  });

  it("reports an activity as absent once the store has evicted its event", () => {
    const index = createHealthTraceIndex();
    const history = oldSession(100);
    deriveTraceHealth(input(history), index);

    const afterEviction = [...history.slice(1), ...recentFailures()];
    const health = deriveTraceHealth(input(afterEviction), index);

    expect(health.lastTelnetActivity).toBeNull();
    expect(health).toEqual(fullScanOutcome(afterEviction));
  });

  it("rebuilds from scratch when the store was replaced", () => {
    const index = createHealthTraceIndex();
    deriveTraceHealth(input(oldSession(100)), index);

    const replaced = recentFailures();
    expect(deriveTraceHealth(input(replaced), index)).toEqual(fullScanOutcome(replaced));
  });

  it("keeps a pinned Healthy verdict until a failure newer than the check arrives", () => {
    const index = createHealthTraceIndex();
    const pinned = {
      overallHealth: "Healthy" as const,
      endTimestamp: new Date(NOW_MS - 30_000).toISOString(),
      probes: { REST: { outcome: "Success" } },
    } as Parameters<typeof deriveTraceHealth>[0]["latestHealthCheck"];
    const beforeCheck = recentFailures().slice(0, 1);

    expect(deriveTraceHealth({ ...input(beforeCheck), latestHealthCheck: pinned }, index).kind).toBe(
      "pinned-health-check",
    );
    expect(deriveTraceHealth({ ...input(recentFailures()), latestHealthCheck: pinned }, index).kind).toBe(
      "trace-derived",
    );
  });
});
