/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  clearHealthHistory,
  getHealthHistory,
  pushHealthHistoryEntry,
  type HealthHistoryEntry,
} from "@/lib/diagnostics/healthHistory";
import {
  clearLatencySamples,
  getAllLatencySamples,
  recordLatencySample,
  type LatencySample,
} from "@/lib/diagnostics/latencyTracker";
import {
  clearRecoveryEvidence,
  getRecoveryEvidence,
  recordRecoveryEvidence,
  type RecoveryEvidenceEvent,
} from "@/lib/diagnostics/recoveryEvidence";
import type {
  HealthCheckProbeRecord,
  HealthCheckProbeType,
  HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";

export type SeedableLatencySample = LatencySample & { path: string };

export const DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT = "c64u-diagnostics-test-overlay-state";

export type DiagnosticsOverlaySeedState = {
  lastHealthCheckResult: HealthCheckRunResult | null;
  liveHealthCheckProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  healthCheckRunning: boolean;
};

export type DiagnosticsTestBridge = {
  seedAnalytics: (payload: {
    healthHistory: HealthHistoryEntry[];
    latencySamples: SeedableLatencySample[];
    recoveryEvents: Array<Omit<RecoveryEvidenceEvent, "id">>;
  }) => void;
  clearAnalytics: () => void;
  seedOverlayState: (payload: Partial<DiagnosticsOverlaySeedState>) => void;
  clearOverlayState: () => void;
  getAnalyticsSnapshot: () => {
    healthHistory: Readonly<HealthHistoryEntry[]>;
    latencySamples: Readonly<LatencySample[]>;
    recoveryEvents: Readonly<RecoveryEvidenceEvent[]>;
  };
  getOverlayStateSnapshot: () => DiagnosticsOverlaySeedState;
};

let overlayState: DiagnosticsOverlaySeedState = {
  lastHealthCheckResult: null,
  liveHealthCheckProbes: null,
  healthCheckRunning: false,
};

const isTestProbeEnabled = () => {
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return true;
  if (typeof window !== "undefined") {
    const win = window as Window & { __c64uTestProbeEnabled?: boolean };
    if (win.__c64uTestProbeEnabled) return true;
  }
  if (typeof process !== "undefined" && process.env?.VITE_ENABLE_TEST_PROBES === "1") return true;
  return false;
};

const clearAnalytics = () => {
  clearLatencySamples();
  clearHealthHistory();
  clearRecoveryEvidence();
};

const seedLatencySamples = (samples: SeedableLatencySample[]) => {
  const originalNow = Date.now;
  try {
    samples.forEach((sample) => {
      Date.now = () => sample.timestampMs;
      recordLatencySample(sample.transport, sample.path, sample.durationMs);
    });
  } finally {
    Date.now = originalNow;
  }
};

const seedAnalytics: DiagnosticsTestBridge["seedAnalytics"] = (payload) => {
  clearAnalytics();
  payload.healthHistory.forEach((entry) => pushHealthHistoryEntry(entry));
  seedLatencySamples(payload.latencySamples);
  payload.recoveryEvents.forEach((event) => recordRecoveryEvidence(event));
};

const publishOverlayState = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT, {
      detail: overlayState,
    }),
  );
};

const seedOverlayState: DiagnosticsTestBridge["seedOverlayState"] = (payload) => {
  overlayState = {
    ...overlayState,
    ...payload,
  };
  publishOverlayState();
};

const clearOverlayState = () => {
  overlayState = {
    lastHealthCheckResult: null,
    liveHealthCheckProbes: null,
    healthCheckRunning: false,
  };
  publishOverlayState();
};

declare global {
  interface Window {
    __c64uDiagnosticsTestBridge?: DiagnosticsTestBridge;
  }
}

export const registerDiagnosticsTestBridge = () => {
  if (typeof window === "undefined") return;
  if (!isTestProbeEnabled()) {
    delete window.__c64uDiagnosticsTestBridge;
    return;
  }
  if (window.__c64uDiagnosticsTestBridge) return;

  window.__c64uDiagnosticsTestBridge = {
    seedAnalytics,
    clearAnalytics,
    seedOverlayState,
    clearOverlayState,
    getAnalyticsSnapshot: () => ({
      healthHistory: getHealthHistory(),
      latencySamples: getAllLatencySamples(),
      recoveryEvents: getRecoveryEvidence(),
    }),
    getOverlayStateSnapshot: () => overlayState,
  };
};
