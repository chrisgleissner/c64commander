/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { delay } from "./timing.js";
import type { HarnessConfig } from "./config.js";
import type { FtpClient } from "./ftpClient.js";
import type { LogEventInput } from "./logging.js";
import type { MultiProtocolHealthMonitor } from "./health.js";
import type { SharedRestRequest } from "./restRequest.js";
import type { TraceCollector } from "./traceCollector.js";
import { createFtpSessionPool } from "./matrixFtpPool.js";
import type { MatrixOp } from "./matrixOperations.js";
import {
  createMatrixFailureSummary,
  createMatrixStageRecords,
  type MatrixRunResult,
  type MatrixStage,
} from "./stressMatrix.js";
import { runStage } from "./stageRunner.js";

type ProtocolAvailability = {
  available: Set<"REST" | "FTP">;
  unavailable: Set<"REST" | "FTP">;
};

export async function runMatrixProfile(input: {
  config: HarnessConfig;
  log: (event: LogEventInput) => void;
  healthMonitor: MultiProtocolHealthMonitor;
  traceCollector?: TraceCollector;
  stages: MatrixStage[];
  operations: Map<string, MatrixOp>;
  restRequest: SharedRestRequest;
}): Promise<MatrixRunResult> {
  const stages = createMatrixStageRecords(input.stages);
  let activeStage = stages[0] ?? null;
  let abortReason: string | null = null;
  let totalRequestsStarted = 0;
  let totalRequestsCompleted = 0;
  const protocolAvailability: ProtocolAvailability = {
    available: new Set(["REST", "FTP"]),
    unavailable: new Set(),
  };

  for (const stage of stages) {
    if (abortReason) {
      break;
    }
    activeStage = stage;
    const operation = input.operations.get(stage.operationId);
    if (!operation) {
      throw new Error(`Unknown matrix operation: ${stage.operationId}`);
    }

    input.traceCollector?.setStageContext(stage.stageId, stage.testType);
    stage.status = "running";
    stage.startedAt = new Date().toISOString();

    if (stage.spikePhase === "idle") {
      await delay(stage.durationMs);
      const assessment = await input.healthMonitor.check({
        stageId: stage.stageId,
        source: `${stage.stageId}:idle`,
      });
      updateProtocolAvailability(protocolAvailability, assessment.availableProtocols, assessment.unavailableProtocols);
      if (assessment.abort) {
        abortReason = assessment.reason;
        stage.status = "aborted";
      } else {
        stage.status = "completed";
      }
      stage.requestsStarted = 0;
      stage.requestsCompleted = 0;
      stage.successCount = assessment.state === "HEALTHY" ? 1 : 0;
      stage.failureCount = stage.successCount === 1 ? 0 : 1;
      stage.endedAt = new Date().toISOString();
      continue;
    }

    const pool = operation.requiresFtpSession
      ? await createFtpSessionPool({
          config: input.config,
          mode: stage.ftpSessionMode,
          concurrency: stage.concurrency,
          traceCollector: input.traceCollector,
        })
      : null;
    let healthLoopStop = false;
    const stageHealthLoop = runMatrixHealthLoop({
      config: input.config,
      healthMonitor: input.healthMonitor,
      getStageId: () => stage.stageId,
      log: input.log,
      onAssessment: (assessment) => {
        updateProtocolAvailability(
          protocolAvailability,
          assessment.availableProtocols,
          assessment.unavailableProtocols,
        );
      },
      onAbort: (reason) => {
        abortReason ??= reason;
      },
      shouldStop: () => healthLoopStop || Boolean(abortReason),
    });

    try {
      const stageAbort = await runStage({
        stage,
        mutation: {
          mutate: async ({ clientId }) => {
            totalRequestsStarted += 1;
            stage.requestsStarted += 1;
            const scopedRestRequest: SharedRestRequest = (requestConfig) =>
              input.restRequest({
                ...requestConfig,
                trace: {
                  ...requestConfig.trace,
                  clientId,
                },
              });
            let ftpClient;
            try {
              const result = await executeWithAvailability({
                operation,
                availability: protocolAvailability,
                acquireFtpClient: async () => {
                  ftpClient = pool ? await pool.acquire(clientId) : undefined;
                  return ftpClient;
                },
                restRequest: scopedRestRequest,
                log: input.log,
                config: input.config,
              });
              totalRequestsCompleted += 1;
              stage.requestsCompleted += 1;
              if (result.ok) {
                stage.successCount += 1;
                stage.lastSuccessAtMs = Date.now();
              } else {
                stage.failureCount += 1;
                stage.firstFailureAtMs ??= Date.now();
                stage.firstFailureError ??= `Matrix operation failed: ${operation.id}`;
              }
            } catch (error) {
              input.log({
                kind: "matrix-op",
                op: operation.id,
                status: "error",
                details: { message: String(error), clientId },
              });
              stage.failureCount += 1;
              stage.firstFailureAtMs ??= Date.now();
              stage.firstFailureError ??= String(error);
            } finally {
              if (ftpClient && pool) {
                await pool.release(ftpClient);
              }
            }
          },
        },
        onAbort: (reason) => {
          abortReason ??= reason;
        },
        shouldAbort: () => abortReason,
      });
      stage.status = stageAbort ? "aborted" : abortReason ? "aborted" : "completed";
    } finally {
      healthLoopStop = true;
      await stageHealthLoop;
      await pool?.teardown();
      stage.endedAt = new Date().toISOString();
    }
  }

  return {
    stages,
    failureSummary: createMatrixFailureSummary({
      stage: activeStage,
      abortReason,
      requestsStarted: totalRequestsStarted,
      requestsCompleted: totalRequestsCompleted,
    }),
    aborted: Boolean(abortReason),
  };
}

async function runMatrixHealthLoop(input: {
  config: HarnessConfig;
  healthMonitor: MultiProtocolHealthMonitor;
  getStageId: () => string;
  log: (event: LogEventInput) => void;
  onAssessment: (assessment: Awaited<ReturnType<MultiProtocolHealthMonitor["check"]>>) => void;
  onAbort: (reason: string) => void;
  shouldStop: () => boolean;
}): Promise<void> {
  const detectionTimeoutMs = input.config.stressMatrix?.failureDetectionTimeoutMs ?? input.config.health.timeoutMs;
  const probeIntervalMs = Math.min(input.config.health.intervalMs, Math.max(250, Math.floor(detectionTimeoutMs / 2)));
  while (!input.shouldStop()) {
    await delay(probeIntervalMs);
    if (input.shouldStop()) {
      break;
    }
    const assessment = await input.healthMonitor.check({
      stageId: input.getStageId(),
      source: `${input.getStageId()}:periodic`,
    });
    input.onAssessment(assessment);
    input.log({
      kind: "health",
      op: `${input.getStageId()}:periodic`,
      status: assessment.state,
      details: {
        reason: assessment.reason,
        availableProtocols: assessment.availableProtocols,
        unavailableProtocols: assessment.unavailableProtocols,
      },
    });
    if (assessment.abort) {
      input.onAbort(assessment.reason);
      return;
    }
  }
}

async function executeWithAvailability(input: {
  operation: MatrixOp;
  availability: ProtocolAvailability;
  acquireFtpClient: () => Promise<FtpClient | undefined>;
  restRequest: SharedRestRequest;
  log: (event: LogEventInput) => void;
  config: HarnessConfig;
}): Promise<{ ok: boolean; latencyMs: number }> {
  if (input.operation.protocol !== "mixed") {
    const ftpClient = input.operation.requiresFtpSession ? await input.acquireFtpClient() : undefined;
    return input.operation.execute({
      restRequest: input.restRequest,
      ftpClient,
      log: input.log,
      config: input.config,
    });
  }

  const restAvailable = input.availability.available.has("REST");
  const ftpAvailable = input.availability.available.has("FTP");

  if (restAvailable && ftpAvailable) {
    const ftpClient = await input.acquireFtpClient();
    return input.operation.execute({
      restRequest: input.restRequest,
      ftpClient,
      log: input.log,
      config: input.config,
    });
  }

  if (restAvailable && !ftpAvailable) {
    const start = Date.now();
    const response = await input.restRequest({ method: "GET", url: "/v1/version" });
    input.log({
      kind: "protocol-exercise",
      op: `${input.operation.id}:rest-fallback`,
      status: response.status,
      latencyMs: response.latencyMs,
      details: { unavailableProtocols: [...input.availability.unavailable] },
    });
    return { ok: response.status === 200, latencyMs: Date.now() - start };
  }

  if (!restAvailable && ftpAvailable) {
    const start = Date.now();
    const ftpClient = await input.acquireFtpClient();
    const response = await ftpClient!.sendCommand("NOOP");
    input.log({
      kind: "protocol-exercise",
      op: `${input.operation.id}:ftp-fallback`,
      status: response.response.code,
      latencyMs: response.latencyMs,
      details: { unavailableProtocols: [...input.availability.unavailable] },
    });
    return { ok: response.response.code < 400, latencyMs: Date.now() - start };
  }

  input.log({
    kind: "protocol-exercise",
    op: `${input.operation.id}:no-protocols-available`,
    status: "unavailable",
    details: { unavailableProtocols: [...input.availability.unavailable] },
  });
  return { ok: false, latencyMs: 0 };
}

function updateProtocolAvailability(
  availability: ProtocolAvailability,
  availableProtocols: readonly string[],
  unavailableProtocols: readonly string[],
): void {
  availability.available.clear();
  availability.unavailable.clear();
  for (const protocol of availableProtocols) {
    if (protocol === "REST" || protocol === "FTP") {
      availability.available.add(protocol);
    }
  }
  for (const protocol of unavailableProtocols) {
    if (protocol === "REST" || protocol === "FTP") {
      availability.unavailable.add(protocol);
    }
  }
}
