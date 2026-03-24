/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FtpSessionMode, HarnessConfig } from "./config.js";

export type MatrixStage = {
  stageId: string;
  order: number;
  testType: "soak" | "stress" | "spike";
  operationId: string;
  protocol: "rest" | "ftp" | "mixed";
  concurrency: number;
  rateDelayMs: number;
  ftpSessionMode: FtpSessionMode;
  durationMs: number;
  spikePhase?: "spike" | "idle";
  cycleNumber?: number;
};

export type MatrixStageRecord = MatrixStage & {
  status: "pending" | "running" | "completed" | "aborted";
  startedAt?: string;
  endedAt?: string;
  requestsStarted: number;
  requestsCompleted: number;
  successCount: number;
  failureCount: number;
  lastSuccessAtMs: number | null;
  firstFailureAtMs: number | null;
  firstFailureError: string | null;
};

export type MatrixFailureSummary = {
  stageId: string | null;
  operationId: string | null;
  abortReason: string | null;
  testType: "soak" | "stress" | "spike" | null;
  requestsStarted: number;
  requestsCompleted: number;
};

export type MatrixRunResult = {
  stages: MatrixStageRecord[];
  failureSummary: MatrixFailureSummary;
  aborted: boolean;
};

export function hasStressMatrix(config: HarnessConfig): config is HarnessConfig & { stressMatrix: NonNullable<HarnessConfig["stressMatrix"]> } {
  return config.mode === "STRESS" && Boolean(config.stressMatrix);
}

export function buildMatrixStagePlan(config: HarnessConfig): MatrixStage[] {
  if (!hasStressMatrix(config)) {
    return [];
  }

  const matrix = config.stressMatrix;
  if (matrix.testType === "soak") {
    return [
      {
        stageId: `soak-01-${matrix.operationId}-c${matrix.concurrency}-r${matrix.rateDelayMs}-${matrix.ftpSessionMode ?? "shared"}`,
        order: 1,
        testType: "soak",
        operationId: matrix.operationId,
        protocol: inferProtocol(matrix.operationId),
        concurrency: matrix.concurrency,
        rateDelayMs: matrix.rateDelayMs,
        ftpSessionMode: matrix.ftpSessionMode ?? "shared",
        durationMs: matrix.durationMs,
      },
    ];
  }

  if (matrix.testType === "stress") {
    const unsorted: MatrixStage[] = [];
    let order = 0;
    for (const rateDelayMs of matrix.rateRampMs) {
      for (const concurrency of matrix.concurrencyLevels) {
        for (const operationId of matrix.operationIds) {
          for (const ftpSessionMode of matrix.ftpSessionModes) {
            unsorted.push({
              stageId: "",
              order: 0,
              testType: "stress",
              operationId,
              protocol: inferProtocol(operationId),
              concurrency,
              rateDelayMs,
              ftpSessionMode,
              durationMs: matrix.stageDurationMs,
            });
          }
        }
      }
    }
    unsorted.sort(
      (left, right) =>
        right.rateDelayMs - left.rateDelayMs ||
        left.concurrency - right.concurrency ||
        left.operationId.localeCompare(right.operationId) ||
        left.ftpSessionMode.localeCompare(right.ftpSessionMode),
    );
    return unsorted.map((stage) => {
      order += 1;
      return {
        ...stage,
        order,
        stageId: `stress-${String(order).padStart(2, "0")}-${stage.operationId}-c${stage.concurrency}-r${stage.rateDelayMs}-${stage.ftpSessionMode}`,
      };
    });
  }

  const stages: MatrixStage[] = [];
  let order = 0;
  const sessionModes = matrix.ftpSessionModes ?? ["shared"];
  for (let cycleNumber = 1; cycleNumber <= matrix.spikeCount; cycleNumber += 1) {
    for (const operationId of matrix.operationIds) {
      const ftpSessionMode = sessionModes[(cycleNumber - 1) % sessionModes.length] ?? "shared";
      order += 1;
      stages.push({
        stageId: `spike-${String(order).padStart(2, "0")}-${operationId}-cycle${cycleNumber}-spike`,
        order,
        testType: "spike",
        operationId,
        protocol: inferProtocol(operationId),
        concurrency: matrix.spikeConcurrency,
        rateDelayMs: matrix.spikeRateDelayMs,
        ftpSessionMode,
        durationMs: matrix.spikeDurationMs,
        spikePhase: "spike",
        cycleNumber,
      });
      order += 1;
      stages.push({
        stageId: `spike-${String(order).padStart(2, "0")}-${operationId}-cycle${cycleNumber}-idle`,
        order,
        testType: "spike",
        operationId,
        protocol: inferProtocol(operationId),
        concurrency: matrix.spikeConcurrency,
        rateDelayMs: matrix.spikeRateDelayMs,
        ftpSessionMode,
        durationMs: matrix.idleDurationMs,
        spikePhase: "idle",
        cycleNumber,
      });
    }
  }
  return stages;
}

export function createMatrixStageRecords(stages: readonly MatrixStage[]): MatrixStageRecord[] {
  return stages.map((stage) => ({
    ...stage,
    status: "pending",
    requestsStarted: 0,
    requestsCompleted: 0,
    successCount: 0,
    failureCount: 0,
    lastSuccessAtMs: null,
    firstFailureAtMs: null,
    firstFailureError: null,
  }));
}

export function createMatrixFailureSummary(input: {
  stage: MatrixStageRecord | null;
  abortReason: string | null;
  requestsStarted: number;
  requestsCompleted: number;
}): MatrixFailureSummary {
  return {
    stageId: input.stage?.stageId ?? null,
    operationId: input.stage?.operationId ?? null,
    abortReason: input.abortReason,
    testType: input.stage?.testType ?? null,
    requestsStarted: input.requestsStarted,
    requestsCompleted: input.requestsCompleted,
  };
}

function inferProtocol(operationId: string): "rest" | "ftp" | "mixed" {
  if (operationId.startsWith("rest.")) {
    return "rest";
  }
  if (operationId.startsWith("ftp.")) {
    return "ftp";
  }
  return "mixed";
}