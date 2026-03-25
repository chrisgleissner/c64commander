import { describe, expect, it, vi } from "vitest";
import { runMatrixProfile } from "./matrixRunner.js";
import { MultiProtocolHealthMonitor } from "./health.js";
import type { HarnessConfig } from "./config.js";
import type { MatrixOp } from "./matrixOperations.js";
import { delay } from "./timing.js";

vi.mock("./matrixFtpPool.js", () => ({
  createFtpSessionPool: async () => ({
    acquire: async () => {
      throw new Error("read ECONNRESET");
    },
    release: async () => undefined,
    teardown: async () => undefined,
  }),
}));

describe("runMatrixProfile", () => {
  it("does not abort the stage when FTP session acquisition throws a transient transport error", async () => {
    const config = buildConfig();
    const healthMonitor = new MultiProtocolHealthMonitor(
      [
        async () => ({ protocol: "REST", ok: true, timestamp: new Date().toISOString(), status: 200, latencyMs: 1 }),
        async () => ({ protocol: "ICMP", ok: true, timestamp: new Date().toISOString(), status: 0, latencyMs: 1 }),
        async () => ({ protocol: "FTP", ok: true, timestamp: new Date().toISOString(), status: 200, latencyMs: 1 }),
      ],
      {
        verificationWindowMs: 5,
        verificationBackoffMs: [1],
      },
    );

    const result = await runMatrixProfile({
      config,
      log: () => undefined,
      healthMonitor,
      stages: [
        {
          stageId: "spike-01-mixed.burst-and-stor-cycle1-spike",
          order: 1,
          testType: "spike",
          operationId: "mixed.burst-and-stor",
          protocol: "mixed",
          concurrency: 1,
          rateDelayMs: 0,
          ftpSessionMode: "per-request",
          durationMs: 50,
          spikePhase: "spike",
          cycleNumber: 1,
        },
      ],
      operations: new Map<string, MatrixOp>([
        [
          "mixed.burst-and-stor",
          {
            id: "mixed.burst-and-stor",
            protocol: "mixed",
            requiresFtpSession: true,
            execute: async () => ({ ok: true, latencyMs: 1 }),
          },
        ],
      ]),
      restRequest: async () => ({
        status: 200,
        data: {},
        headers: {},
        requestHeaders: {},
        latencyMs: 1,
        correlationId: "rest-1",
      }),
    });

    expect(result.aborted).toBe(false);
    expect(result.failureSummary.abortReason).toBeNull();
    expect(result.stages[0]?.status).toBe("completed");
    expect(result.stages[0]?.failureCount).toBeGreaterThan(0);
  });

  it("keeps exercising rest when ftp is unavailable during a mixed stage", async () => {
    const log = vi.fn();
    const config = buildConfig();
    const healthMonitor = new MultiProtocolHealthMonitor(
      [
        async () => ({ protocol: "REST", ok: true, timestamp: new Date().toISOString(), status: 200, latencyMs: 1 }),
        async () => ({ protocol: "ICMP", ok: true, timestamp: new Date().toISOString(), status: 0, latencyMs: 1 }),
        async () => ({
          protocol: "FTP",
          ok: false,
          timestamp: new Date().toISOString(),
          status: "ftp-failed",
          latencyMs: 1,
          error: "FTP failed",
        }),
      ],
      {
        verificationWindowMs: 5,
        verificationBackoffMs: [1],
      },
    );

    await healthMonitor.check({ source: "seed:ftp-down", stageId: "spike-01-mixed.burst-and-stor-cycle1-spike" });

    const result = await runMatrixProfile({
      config,
      log,
      healthMonitor,
      stages: [
        {
          stageId: "spike-01-mixed.burst-and-stor-cycle1-spike",
          order: 1,
          testType: "spike",
          operationId: "mixed.burst-and-stor",
          protocol: "mixed",
          concurrency: 1,
          rateDelayMs: 10,
          ftpSessionMode: "per-request",
          durationMs: 250,
          spikePhase: "spike",
          cycleNumber: 1,
        },
      ],
      operations: new Map<string, MatrixOp>([
        [
          "mixed.burst-and-stor",
          {
            id: "mixed.burst-and-stor",
            protocol: "mixed",
            requiresFtpSession: true,
            execute: async () => {
              await delay(30);
              return { ok: true, latencyMs: 30 };
            },
          },
        ],
      ]),
      restRequest: async () => ({
        status: 200,
        data: {},
        headers: {},
        requestHeaders: {},
        latencyMs: 1,
        correlationId: "rest-2",
      }),
    });

    expect(result.aborted).toBe(false);
    expect(
      log.mock.calls.some(
        ([event]) =>
          event.kind === "protocol-exercise" &&
          event.op === "mixed.burst-and-stor:rest-fallback" &&
          event.status === 200,
      ),
    ).toBe(true);
  });
});

function buildConfig(): HarnessConfig {
  return {
    baseUrl: "http://127.0.0.1",
    mode: "STRESS",
    auth: "OFF",
    password: "",
    ftpMode: "PASV",
    ftpPort: 21,
    outputDir: "test-results/contract",
    concurrency: {
      restMaxInFlight: 1,
      ftpMaxSessions: 1,
      mixedMaxInFlight: 1,
    },
    pacing: {
      restMinDelayMs: 0,
      ftpMinDelayMs: 0,
    },
    health: {
      endpoint: "/v1/info",
      intervalMs: 100,
      timeoutMs: 100,
    },
    timeouts: {
      restTimeoutMs: 100,
      ftpTimeoutMs: 100,
      scenarioTimeoutMs: 1_000,
      maxDestructiveScenarioMs: 1_000,
    },
    scratch: {
      ftpDir: "/Temp/contract-test",
    },
    allowMachineReset: false,
    trace: {
      enabled: true,
      level: "full",
    },
    stressMatrix: {
      testType: "spike",
      operationIds: ["mixed.burst-and-stor"],
      spikeConcurrency: 1,
      spikeRateDelayMs: 0,
      spikeDurationMs: 5,
      idleDurationMs: 5,
      spikeCount: 1,
      failureDetectionTimeoutMs: 100,
      ftpSessionModes: ["per-request"],
    },
  };
}
