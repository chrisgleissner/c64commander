/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import type {
  HealthCheckProbeRecord,
  HealthCheckProbeType,
  HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";

export type HealthCheckRunLifecycle = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMEOUT";

export type HealthCheckProbeLifecycle = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "TIMEOUT" | "CANCELLED";

export type HealthCheckProbeExecutionState = {
  state: HealthCheckProbeLifecycle;
  outcome: HealthCheckProbeRecord["outcome"] | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  reason: string | null;
};

export type HealthCheckTransitionEvent = {
  id: string;
  timestamp: string;
  scope: "run" | "probe";
  target: string;
  from: string | null;
  to: string;
  reason: string | null;
};

const PROBE_ORDER: ReadonlyArray<HealthCheckProbeType> = ["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY"];

const buildDefaultProbeStates = (): Record<HealthCheckProbeType, HealthCheckProbeExecutionState> =>
  PROBE_ORDER.reduce<Record<HealthCheckProbeType, HealthCheckProbeExecutionState>>(
    (acc, probe) => {
      acc[probe] = {
        state: "PENDING",
        outcome: null,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        reason: null,
      };
      return acc;
    },
    {} as Record<HealthCheckProbeType, HealthCheckProbeExecutionState>,
  );

export type HealthCheckStateSnapshot = {
  running: boolean;
  runState: HealthCheckRunLifecycle;
  currentRunId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  staleAfterMs: number | null;
  lastTransitionReason: string | null;
  liveProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  probeStates: Record<HealthCheckProbeType, HealthCheckProbeExecutionState>;
  latestResult: HealthCheckRunResult | null;
  transitions: HealthCheckTransitionEvent[];
};

let snapshot: HealthCheckStateSnapshot = {
  running: false,
  runState: "IDLE",
  currentRunId: null,
  startedAt: null,
  endedAt: null,
  staleAfterMs: null,
  lastTransitionReason: null,
  liveProbes: null,
  probeStates: buildDefaultProbeStates(),
  latestResult: null,
  transitions: [],
};

const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

export const getHealthCheckStateSnapshot = () => snapshot;

export const subscribeHealthCheckState = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setHealthCheckStateSnapshot = (next: Partial<HealthCheckStateSnapshot>) => {
  snapshot = {
    ...snapshot,
    ...next,
  };
  emit();
};

export const appendHealthCheckTransition = (event: Omit<HealthCheckTransitionEvent, "id">) => {
  const nextEvent: HealthCheckTransitionEvent = {
    ...event,
    id: `health-transition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const transitions = [...snapshot.transitions, nextEvent].slice(-50);
  snapshot = {
    ...snapshot,
    transitions,
  };
  emit();
};

export const resetHealthCheckProbeStates = () => buildDefaultProbeStates();

export const resetHealthCheckStateSnapshot = () => {
  snapshot = {
    running: false,
    runState: "IDLE",
    currentRunId: null,
    startedAt: null,
    endedAt: null,
    staleAfterMs: null,
    lastTransitionReason: null,
    liveProbes: null,
    probeStates: buildDefaultProbeStates(),
    latestResult: null,
    transitions: [],
  };
  emit();
};

export const useHealthCheckState = () =>
  useSyncExternalStore(subscribeHealthCheckState, getHealthCheckStateSnapshot, getHealthCheckStateSnapshot);
