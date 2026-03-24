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
import type { ProbeResult, HealthMonitor } from "./health.js";
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
  healthMonitor: HealthMonitor;
  ftpHealthMonitor?: HealthMonitor;
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
      const restResult = await input.healthMonitor.check();
      const ftpResult =
        shouldUseFtpHealth(stage) && input.ftpHealthMonitor ? await input.ftpHealthMonitor.check() : null;
      const reason = healthAbortReason(input.healthMonitor, input.ftpHealthMonitor, ftpResult);
      if (reason) {
        abortReason = reason;
        stage.status = "aborted";
      } else {
        stage.status = "completed";
      }
      stage.requestsStarted = 0;
      stage.requestsCompleted = 0;
      stage.successCount = restResult.ok && (!ftpResult || ftpResult.ok) ? 1 : 0;
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
      ftpHealthMonitor: shouldUseFtpHealth(stage) ? input.ftpHealthMonitor : undefined,
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
            const ftpClient = pool ? await pool.acquire(clientId) : undefined;
            try {
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
  healthMonitor: HealthMonitor;
  ftpHealthMonitor?: HealthMonitor;
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
    const restResult = await input.healthMonitor.check();
    input.log({
      kind: "health",
      op: `${input.getStageId()}:rest`,
      status: restResult.status ?? (restResult.ok ? 200 : "fail"),
      latencyMs: restResult.latencyMs,
      details: { error: restResult.error },
    });
    const ftpResult = input.ftpHealthMonitor ? await input.ftpHealthMonitor.check() : null;
    if (ftpResult) {
      input.log({
        kind: "health",
        op: `${input.getStageId()}:ftp`,
        status: ftpResult.status ?? (ftpResult.ok ? 200 : "fail"),
        latencyMs: ftpResult.latencyMs,
        details: { error: ftpResult.error },
      });
    }
    const reason = healthAbortReason(input.healthMonitor, input.ftpHealthMonitor, ftpResult);
    if (reason) {
      input.onAbort(reason);
      return;
    }
  }
}

function healthAbortReason(
  restMonitor: HealthMonitor,
  ftpMonitor?: HealthMonitor,
  _ftpResult?: ProbeResult | null,
): string | null {
  const restAbort = restMonitor.shouldAbort();
  if (restAbort.abort) {
    return restAbort.reason ?? "REST health probe aborted";
  }
  if (ftpMonitor) {
    const ftpAbort = ftpMonitor.shouldAbort();
    if (ftpAbort.abort) {
      return ftpAbort.reason ?? "FTP health probe aborted";
    }
  }
  return null;
}

function shouldUseFtpHealth(stage: MatrixStage): boolean {
  return stage.protocol === "ftp" || stage.protocol === "mixed";
}
