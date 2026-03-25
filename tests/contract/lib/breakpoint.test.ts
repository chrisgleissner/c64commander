import { describe, expect, it } from "vitest";
import {
  buildBreakpointStagePlan,
  createBreakpointFailureSummary,
  shouldSkipRecoveryAfterBreakpointFailure,
  shouldSkipRecovery,
  TraceTailBuffer,
} from "./breakpoint.js";
import type { HarnessConfig } from "./config.js";

describe("breakpoint stage planning", () => {
  it("builds deterministic stages and caps concurrency at the harness limit", () => {
    const stages = buildBreakpointStagePlan(buildConfig());
    expect(
      stages.map((stage) => [stage.stageId, stage.rateDelayMs, stage.concurrency, stage.requestedConcurrency]),
    ).toEqual([
      ["stage-01-r2000-c1", 2000, 1, 1],
      ["stage-02-r2000-c3", 2000, 3, 4],
      ["stage-03-r500-c1", 500, 1, 1],
      ["stage-04-r500-c3", 500, 3, 4],
    ]);
  });

  it("builds failure summaries and skips recovery when the run aborts or resets are disabled", () => {
    const stages = buildBreakpointStagePlan(buildConfig());
    const summary = createBreakpointFailureSummary({
      stage: {
        ...stages[1],
        status: "aborted",
        requestsStarted: 12,
        requestsCompleted: 9,
        lastSuccessfulRequestSequence: 14,
        firstFailedRequestSequence: 15,
      },
      targets: buildConfig().stressBreakpoint!.targets,
      totalRequestsStarted: 16,
      totalRequestsCompleted: 12,
      lastSuccessfulRequestSequence: 14,
      firstFailedRequestSequence: 15,
      healthStatus: {
        ok: false,
        status: 503,
        checkedAt: "2026-03-11T12:00:00.000Z",
        abortReason: "Health probe failed 2 times",
      },
      abortReason: "PUT /v1/configs failed",
    });

    expect(summary.stageId).toBe("stage-02-r2000-c3");
    expect(summary.abortReason).toBe("PUT /v1/configs failed");
    expect(
      shouldSkipRecovery({
        config: buildConfig(),
        outcome: "device-unresponsive",
      }),
    ).toBe(true);
    expect(
      shouldSkipRecovery({
        config: { ...buildConfig(), stressBreakpoint: undefined, mode: "SAFE" },
        outcome: "completed",
      }),
    ).toBe(true);
    expect(
      shouldSkipRecovery({
        config: { ...buildConfig(), allowMachineReset: true, stressBreakpoint: undefined, mode: "SAFE" },
        outcome: "completed",
      }),
    ).toBe(false);
    expect(
      shouldSkipRecoveryAfterBreakpointFailure({
        config: buildConfig(),
        abortReason: "device-unresponsive",
      }),
    ).toBe(true);
  });

  it("keeps only the configured trace tail length", () => {
    const buffer = new TraceTailBuffer(2);
    buffer.push(minimalTraceEntry(1));
    buffer.push(minimalTraceEntry(2));
    buffer.push(minimalTraceEntry(3));
    expect(buffer.snapshot().map((entry) => entry.requestSequence)).toEqual([2, 3]);
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
      restMaxInFlight: 3,
      ftpMaxSessions: 1,
      mixedMaxInFlight: 2,
    },
    pacing: {
      restMinDelayMs: 10,
      ftpMinDelayMs: 10,
    },
    health: {
      endpoint: "/v1/version",
      intervalMs: 500,
      timeoutMs: 200,
    },
    timeouts: {
      restTimeoutMs: 500,
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
      rateRampMs: [2000, 500],
      concurrencyRamp: [1, 4],
      stageDurationMs: 1000,
      failureDetectionTimeoutMs: 400,
      tailRequestCount: 2,
      targets: [
        { category: "Audio Mixer", item: "Vol Socket 1" },
        { category: "Audio Mixer", item: "Vol Socket 2" },
      ],
    },
  };
}

function minimalTraceEntry(requestSequence: number) {
  return {
    timestamp: "2026-03-11T12:00:00.000Z",
    runId: "run-1",
    stageId: "stage-01-r2000-c1",
    requestSequence,
    attempt: 1,
    clientId: "client-1",
    method: "PUT",
    url: "/v1/configs/Audio%20Mixer/Vol%20Socket%201",
    responseStatus: 200,
    concurrencyLevel: 1,
    rateDelayMs: 2000,
    target: {
      category: "Audio Mixer",
      item: "Vol Socket 1",
    },
  };
}
