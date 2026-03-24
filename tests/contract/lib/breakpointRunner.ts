/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { delay } from "./timing.js";
import type { LogEventInput } from "./logging.js";
import type { ProbeResult, HealthMonitor } from "./health.js";
import { runStage } from "./stageRunner.js";
import {
  type BreakpointFailureSummary,
  type BreakpointHealthStatus,
  type BreakpointRequestTraceContext,
  type BreakpointStageRecord,
  type BreakpointTraceEntry,
  TraceTailBuffer,
  buildBreakpointStagePlan,
  createBreakpointFailureSummary,
  createBreakpointStageRecords,
} from "./breakpoint.js";
import type { HarnessConfig, StressBreakpointTarget } from "./config.js";

type PreparedBreakpointScenario = {
  id: string;
  targets: StressBreakpointTarget[];
  mutate: (input: { clientId: string }) => Promise<void>;
};

export type BreakpointRunResult = {
  stages: BreakpointStageRecord[];
  failureSummary: BreakpointFailureSummary;
  traceTail: BreakpointTraceEntry[];
  aborted: boolean;
};

export async function runStressBreakpointProfile(input: {
  config: HarnessConfig;
  log: (event: LogEventInput) => void;
  healthMonitor: HealthMonitor;
  prepareScenario: () => Promise<PreparedBreakpointScenario>;
  setTraceDefaults: (defaults: BreakpointRequestTraceContext | null) => void;
  onTrace: (listener: (entry: BreakpointTraceEntry) => void) => void;
}): Promise<BreakpointRunResult> {
  if (!input.config.stressBreakpoint) {
    throw new Error("stressBreakpoint config is required");
  }

  const stages = createBreakpointStageRecords(buildBreakpointStagePlan(input.config));
  const traceTail = new TraceTailBuffer(input.config.stressBreakpoint.tailRequestCount);
  let totalRequestsStarted = 0;
  let totalRequestsCompleted = 0;
  let lastSuccessfulRequestSequence: number | null = null;
  let firstFailedRequestSequence: number | null = null;
  let activeStage: BreakpointStageRecord | null = null;
  let abortReason: string | null = null;
  let lastHealthStatus: BreakpointHealthStatus = {
    ok: true,
  };

  input.onTrace((entry) => {
    traceTail.push(entry);
    if (entry.attempt === 1) {
      totalRequestsStarted += 1;
      if (activeStage) {
        activeStage.requestsStarted += 1;
      }
    }
    if (entry.willRetry) {
      return;
    }
    totalRequestsCompleted += 1;
    if (activeStage) {
      activeStage.requestsCompleted += 1;
    }
    if (entry.responseStatus === 200) {
      lastSuccessfulRequestSequence = entry.requestSequence;
      if (activeStage) {
        activeStage.lastSuccessfulRequestSequence = entry.requestSequence;
      }
      return;
    }
    firstFailedRequestSequence ??= entry.requestSequence;
    if (activeStage) {
      activeStage.firstFailedRequestSequence ??= entry.requestSequence;
    }
  });

  input.setTraceDefaults({
    stageId: "setup",
    clientId: "breakpoint-setup",
    concurrencyLevel: 1,
    rateDelayMs: 0,
    target: { category: null, item: null },
  });

  const scenario = await input.prepareScenario();
  if (scenario.id !== input.config.stressBreakpoint.scenarioId) {
    throw new Error(
      `Configured breakpoint scenario ${input.config.stressBreakpoint.scenarioId} did not resolve to ${scenario.id}`,
    );
  }

  const healthLoopAbort = { stop: false };
  const healthLoop = runHealthLoop({
    config: input.config,
    healthMonitor: input.healthMonitor,
    log: input.log,
    getCurrentStage: () => activeStage,
    onHealthStatus: (status) => {
      lastHealthStatus = status;
      if (status.abortReason && !abortReason) {
        abortReason = status.abortReason;
      }
    },
    shouldStop: () => healthLoopAbort.stop || Boolean(abortReason),
  });

  try {
    for (const stage of stages) {
      if (abortReason) {
        break;
      }
      activeStage = stage;
      stage.status = "running";
      stage.startedAt = new Date().toISOString();
      input.setTraceDefaults({
        stageId: stage.stageId,
        clientId: "breakpoint-worker",
        concurrencyLevel: stage.concurrency,
        rateDelayMs: stage.rateDelayMs,
        target: { category: null, item: null },
      });
      input.log({
        kind: "scenario",
        op: scenario.id,
        status: "stage-start",
        details: {
          stageId: stage.stageId,
          rateDelayMs: stage.rateDelayMs,
          concurrency: stage.concurrency,
          requestedConcurrency: stage.requestedConcurrency,
        },
      });

      const stageAbort = await runStage({
        stage,
        mutation: {
          mutate: ({ clientId }) => scenario.mutate({ clientId }),
        },
        onAbort: (reason) => {
          abortReason ??= reason;
        },
        shouldAbort: () => abortReason,
      });

      stage.endedAt = new Date().toISOString();
      stage.status = stageAbort ? "aborted" : "completed";
      input.log({
        kind: "scenario",
        op: scenario.id,
        status: stage.status,
        details: {
          stageId: stage.stageId,
          requestsStarted: stage.requestsStarted,
          requestsCompleted: stage.requestsCompleted,
          abortReason: stageAbort ?? undefined,
        },
      });
    }
  } finally {
    healthLoopAbort.stop = true;
    await healthLoop;
    input.setTraceDefaults(null);
  }

  const failureSummary = createBreakpointFailureSummary({
    stage: activeStage,
    targets: scenario.targets,
    totalRequestsStarted,
    totalRequestsCompleted,
    lastSuccessfulRequestSequence,
    firstFailedRequestSequence,
    healthStatus: lastHealthStatus,
    abortReason,
  });

  return {
    stages,
    failureSummary,
    traceTail: traceTail.snapshot(),
    aborted: Boolean(abortReason),
  };
}

async function runHealthLoop(input: {
  config: HarnessConfig;
  healthMonitor: HealthMonitor;
  log: (event: LogEventInput) => void;
  getCurrentStage: () => BreakpointStageRecord | null;
  onHealthStatus: (status: BreakpointHealthStatus) => void;
  shouldStop: () => boolean;
}): Promise<void> {
  const detectionTimeoutMs = input.config.stressBreakpoint?.failureDetectionTimeoutMs ?? input.config.health.timeoutMs;
  const probeIntervalMs = Math.min(input.config.health.intervalMs, Math.max(250, Math.floor(detectionTimeoutMs / 2)));

  while (!input.shouldStop()) {
    await delay(probeIntervalMs);
    if (input.shouldStop()) {
      break;
    }
    const result = await input.healthMonitor.check();
    const abort = input.healthMonitor.shouldAbort();
    const status = mapHealthStatus(result, abort.reason);
    input.onHealthStatus(status);
    input.log({
      kind: "health",
      op: `${input.getCurrentStage()?.stageId ?? "breakpoint"}:periodic`,
      status: result.status ?? "fail",
      latencyMs: result.latencyMs,
      details: {
        error: result.error,
        abortReason: abort.reason,
      },
    });
    if (abort.abort) {
      return;
    }
  }
}

function mapHealthStatus(result: ProbeResult, abortReason?: string): BreakpointHealthStatus {
  return {
    ok: result.ok,
    status: result.status,
    error: result.error,
    latencyMs: result.latencyMs,
    checkedAt: new Date().toISOString(),
    abortReason,
  };
}
