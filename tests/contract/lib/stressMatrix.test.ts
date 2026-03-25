import { describe, expect, it } from "vitest";
import { buildMatrixStagePlan, createMatrixStageRecords, hasStressMatrix } from "./stressMatrix.js";
import type { HarnessConfig } from "./config.js";

describe("stress matrix planning", () => {
  it("builds stress stages in gentlest-first order", () => {
    const plan = buildMatrixStagePlan(buildStressConfig());
    expect(plan.map((stage) => stage.stageId)).toEqual([
      "stress-01-ftp.dir-list-c1-r1000-shared",
      "stress-02-rest.read-version-c1-r1000-shared",
      "stress-03-ftp.dir-list-c4-r1000-shared",
      "stress-04-rest.read-version-c4-r1000-shared",
      "stress-05-ftp.dir-list-c1-r0-shared",
      "stress-06-rest.read-version-c1-r0-shared",
      "stress-07-ftp.dir-list-c4-r0-shared",
      "stress-08-rest.read-version-c4-r0-shared",
    ]);
    expect(createMatrixStageRecords(plan).every((stage) => stage.status === "pending")).toBe(true);
    expect(hasStressMatrix(buildStressConfig())).toBe(true);
  });

  it("builds a single soak stage and paired spike phases", () => {
    const soak = buildMatrixStagePlan(buildSoakConfig());
    expect(soak).toHaveLength(1);
    expect(soak[0]?.stageId).toContain("soak-01");

    const spike = buildMatrixStagePlan(buildSpikeConfig());
    expect(spike.map((stage) => stage.spikePhase)).toEqual(["spike", "idle", "spike", "idle"]);
  });
});

function buildBaseConfig(): HarnessConfig {
  return {
    baseUrl: "http://127.0.0.1",
    mode: "STRESS",
    auth: "OFF",
    password: "",
    ftpMode: "PASV",
    ftpPort: 21,
    outputDir: "test-results/contract",
    concurrency: {
      restMaxInFlight: 4,
      ftpMaxSessions: 2,
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
    trace: {
      enabled: true,
      level: "full",
    },
  };
}

function buildStressConfig(): HarnessConfig {
  return {
    ...buildBaseConfig(),
    stressMatrix: {
      testType: "stress",
      operationIds: ["rest.read-version", "ftp.dir-list"],
      concurrencyLevels: [1, 4],
      rateRampMs: [1000, 0],
      ftpSessionModes: ["shared"],
      stageDurationMs: 1000,
      failureDetectionTimeoutMs: 400,
      tailRequestCount: 10,
    },
  };
}

function buildSoakConfig(): HarnessConfig {
  return {
    ...buildBaseConfig(),
    stressMatrix: {
      testType: "soak",
      operationId: "ftp.dir-list",
      concurrency: 2,
      rateDelayMs: 500,
      durationMs: 1000,
      failureDetectionTimeoutMs: 400,
      ftpSessionMode: "shared",
    },
  };
}

function buildSpikeConfig(): HarnessConfig {
  return {
    ...buildBaseConfig(),
    stressMatrix: {
      testType: "spike",
      operationIds: ["ftp.large-roundtrip", "mixed.burst-and-stor"],
      spikeConcurrency: 3,
      spikeRateDelayMs: 0,
      spikeDurationMs: 500,
      idleDurationMs: 600,
      spikeCount: 1,
      failureDetectionTimeoutMs: 400,
      ftpSessionModes: ["shared"],
    },
  };
}
