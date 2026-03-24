import { afterEach, describe, expect, it } from "vitest";
import { createMockRestServer } from "../mockRestServer.js";
import { RestClient } from "./restClient.js";
import { MultiProtocolHealthMonitor } from "./health.js";
import { createRestRequest } from "./restRequest.js";
import { runStressBreakpointProfile } from "./breakpointRunner.js";
import { prepareSidVolumeBreakpointScenario } from "../scenarios/rest/breakpointSidVolume.js";
import type { BreakpointRequestTraceContext, BreakpointTraceEntry } from "./breakpoint.js";
import type { HarnessConfig } from "./config.js";

describe("runStressBreakpointProfile", () => {
  let cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(cleanup.map((close) => close()));
    cleanup = [];
  });

  it("aborts immediately after a deterministic SID volume mutation failure and preserves forensic state", async () => {
    const server = await createMockRestServer({
      breakpointFailure: {
        afterRequests: 2,
        mode: "status",
        status: 503,
        methods: ["PUT"],
        pathIncludes: "/v1/configs/",
      },
    });
    cleanup.push(server.close);

    const config = buildConfig(server.baseUrl);
    let currentTraceDefaults: BreakpointRequestTraceContext | null = null;
    const traceListeners = new Set<(entry: BreakpointTraceEntry) => void>();
    const restClient = new RestClient({
      baseUrl: server.baseUrl,
      auth: "OFF",
      password: "",
      timeoutMs: config.timeouts.restTimeoutMs,
      keepAlive: true,
      maxSockets: 4,
    });
    const restRequest = createRestRequest(restClient, {
      mode: config.mode,
      breakpointTrace: {
        runId: "run-123",
        log: () => undefined,
        getDefaults: () => currentTraceDefaults,
        onTrace: (entry) => {
          for (const listener of traceListeners) {
            listener(entry);
          }
        },
      },
    });
    const healthMonitor = new MultiProtocolHealthMonitor(
      [
        async () => {
          const response = await restRequest({
            method: "GET",
            url: config.health.endpoint,
            trace: {
              clientId: "health-monitor",
              target: { category: null, item: null },
            },
          });
          return {
            protocol: "REST",
            ok: response.status === 200,
            timestamp: new Date().toISOString(),
            status: response.status,
            latencyMs: response.latencyMs,
          };
        },
        async () => ({ protocol: "ICMP", ok: true, timestamp: new Date().toISOString(), status: 0, latencyMs: 1 }),
        async () => ({ protocol: "FTP", ok: true, timestamp: new Date().toISOString(), status: 200, latencyMs: 1 }),
      ],
      {
        verificationWindowMs: 10,
        verificationBackoffMs: [1],
      },
    );

    const result = await runStressBreakpointProfile({
      config,
      log: () => undefined,
      healthMonitor,
      prepareScenario: () => prepareSidVolumeBreakpointScenario({ request: restRequest, log: () => undefined, config }),
      setTraceDefaults: (defaults) => {
        currentTraceDefaults = defaults;
      },
      onTrace: (listener) => {
        traceListeners.add(listener);
      },
    });

    expect(result.aborted).toBe(true);
    expect(result.failureSummary.abortReason).toMatch(/Breakpoint SID volume mutation failed/);
    expect(result.failureSummary.firstFailedRequestSequence).not.toBeNull();
    expect(result.stages[0]?.status).toBe("aborted");
    expect(result.traceTail.length).toBeGreaterThan(0);
  });
});

function buildConfig(baseUrl: string): HarnessConfig {
  return {
    baseUrl,
    mode: "STRESS",
    auth: "OFF",
    password: "",
    ftpMode: "PASV",
    ftpPort: 21,
    outputDir: "test-results/contract",
    concurrency: {
      restMaxInFlight: 2,
      ftpMaxSessions: 1,
      mixedMaxInFlight: 2,
    },
    pacing: {
      restMinDelayMs: 5,
      ftpMinDelayMs: 5,
    },
    health: {
      endpoint: "/v1/version",
      intervalMs: 100,
      timeoutMs: 100,
    },
    timeouts: {
      restTimeoutMs: 100,
      ftpTimeoutMs: 500,
      scenarioTimeoutMs: 1000,
      maxDestructiveScenarioMs: 1000,
    },
    scratch: {
      ftpDir: "/Temp/contract-test",
    },
    allowMachineReset: false,
    stressBreakpoint: {
      scenarioId: "rest.breakpoint.sid-volume",
      rateRampMs: [1],
      concurrencyRamp: [1],
      stageDurationMs: 200,
      failureDetectionTimeoutMs: 150,
      tailRequestCount: 5,
      targets: [
        { category: "Audio Mixer", item: "Vol Socket 1" },
        { category: "Audio Mixer", item: "Vol Socket 2" },
      ],
    },
  };
}
