/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HarnessConfig, StressBreakpointConfig, StressBreakpointTarget } from "./config.js";

export type BreakpointStage = {
  stageId: string;
  order: number;
  scenarioId: string;
  rateDelayMs: number;
  requestedConcurrency: number;
  concurrency: number;
  durationMs: number;
  targets: StressBreakpointTarget[];
};

export type BreakpointStageRecord = BreakpointStage & {
  status: "pending" | "running" | "completed" | "aborted";
  startedAt?: string;
  endedAt?: string;
  requestsStarted: number;
  requestsCompleted: number;
  lastSuccessfulRequestSequence: number | null;
  firstFailedRequestSequence: number | null;
};

export type BreakpointHealthStatus = {
  ok: boolean;
  status?: number;
  error?: string;
  latencyMs?: number;
  checkedAt?: string;
  abortReason?: string;
};

export type BreakpointFailureSummary = {
  stageId: string | null;
  rateDelayMs: number | null;
  concurrency: number | null;
  targets: StressBreakpointTarget[];
  totalRequestsStarted: number;
  totalRequestsCompleted: number;
  lastSuccessfulRequestSequence: number | null;
  firstFailedRequestSequence: number | null;
  healthStatus: BreakpointHealthStatus;
  abortReason: string | null;
};

export type BreakpointTraceEntry = {
  timestamp: string;
  runId: string;
  stageId: string;
  requestSequence: number;
  attempt: number;
  clientId: string;
  method: string;
  url: string;
  headers?: unknown;
  params?: unknown;
  payload?: unknown;
  responseStatus?: number;
  responseHeaders?: unknown;
  responseBody?: unknown;
  latencyMs?: number;
  concurrencyLevel: number;
  rateDelayMs: number;
  target: {
    category: string | null;
    item: string | null;
  };
  error?: string;
  willRetry?: boolean;
  retryDelayMs?: number;
};

export type RecoveryOutcome = "completed" | "device-unresponsive";

export type BreakpointRequestTraceContext = {
  stageId?: string;
  clientId?: string;
  concurrencyLevel?: number;
  rateDelayMs?: number;
  target?: {
    category?: string | null;
    item?: string | null;
  };
};

export function hasStressBreakpoint(config: HarnessConfig): config is HarnessConfig & {
  stressBreakpoint: StressBreakpointConfig;
} {
  return config.mode === "STRESS" && Boolean(config.stressBreakpoint);
}

export function buildBreakpointStagePlan(config: HarnessConfig): BreakpointStage[] {
  if (!hasStressBreakpoint(config)) {
    return [];
  }

  const plan: BreakpointStage[] = [];
  let order = 0;
  for (const rateDelayMs of config.stressBreakpoint.rateRampMs) {
    for (const requestedConcurrency of config.stressBreakpoint.concurrencyRamp) {
      order += 1;
      const concurrency = Math.min(requestedConcurrency, config.concurrency.restMaxInFlight);
      plan.push({
        stageId: `stage-${String(order).padStart(2, "0")}-r${rateDelayMs}-c${concurrency}`,
        order,
        scenarioId: config.stressBreakpoint.scenarioId,
        rateDelayMs,
        requestedConcurrency,
        concurrency,
        durationMs: config.stressBreakpoint.stageDurationMs,
        targets: config.stressBreakpoint.targets,
      });
    }
  }
  return plan;
}

export function createBreakpointStageRecords(stages: BreakpointStage[]): BreakpointStageRecord[] {
  return stages.map((stage) => ({
    ...stage,
    status: "pending",
    requestsStarted: 0,
    requestsCompleted: 0,
    lastSuccessfulRequestSequence: null,
    firstFailedRequestSequence: null,
  }));
}

export function createBreakpointFailureSummary(input: {
  stage: BreakpointStageRecord | null;
  targets: StressBreakpointTarget[];
  totalRequestsStarted: number;
  totalRequestsCompleted: number;
  lastSuccessfulRequestSequence: number | null;
  firstFailedRequestSequence: number | null;
  healthStatus: BreakpointHealthStatus;
  abortReason: string | null;
}): BreakpointFailureSummary {
  return {
    stageId: input.stage?.stageId ?? null,
    rateDelayMs: input.stage?.rateDelayMs ?? null,
    concurrency: input.stage?.concurrency ?? null,
    targets: input.targets,
    totalRequestsStarted: input.totalRequestsStarted,
    totalRequestsCompleted: input.totalRequestsCompleted,
    lastSuccessfulRequestSequence: input.lastSuccessfulRequestSequence,
    firstFailedRequestSequence: input.firstFailedRequestSequence,
    healthStatus: input.healthStatus,
    abortReason: input.abortReason,
  };
}

export function shouldSkipRecovery(input: { config: HarnessConfig; outcome: RecoveryOutcome }): boolean {
  return input.outcome === "device-unresponsive" || input.config.allowMachineReset !== true;
}

export class TraceTailBuffer {
  private readonly entries: BreakpointTraceEntry[] = [];

  constructor(private readonly limit: number) {}

  push(entry: BreakpointTraceEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.limit) {
      this.entries.shift();
    }
  }

  snapshot(): BreakpointTraceEntry[] {
    return [...this.entries];
  }
}
