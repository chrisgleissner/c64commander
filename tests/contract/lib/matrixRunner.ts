/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { delay } from "./timing.js";
import type { HarnessConfig } from "./config.js";
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
              ftpClient = pool ? await pool.acquire(clientId) : undefined;
              const result = await operation.execute({
                restRequest: scopedRestRequest,
                ftpClient,
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
    input.log({
      kind: "health",
      op: `${input.getStageId()}:periodic`,
      status: assessment.state,
      details: { reason: assessment.reason },
    });
    if (assessment.abort) {
      input.onAbort(assessment.reason);
      return;
    }
  }
}
