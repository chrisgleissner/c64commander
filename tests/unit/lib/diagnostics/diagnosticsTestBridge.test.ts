/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearHealthHistory } from "@/lib/diagnostics/healthHistory";
import { clearLatencySamples } from "@/lib/diagnostics/latencyTracker";
import { clearRecoveryEvidence } from "@/lib/diagnostics/recoveryEvidence";
import {
  DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT,
  registerDiagnosticsTestBridge,
} from "@/lib/diagnostics/diagnosticsTestBridge";

describe("registerDiagnosticsTestBridge", () => {
  beforeEach(() => {
    clearHealthHistory();
    clearLatencySamples();
    clearRecoveryEvidence();
    delete (window as Window & { __c64uDiagnosticsTestBridge?: unknown }).__c64uDiagnosticsTestBridge;
  });

  afterEach(() => {
    clearHealthHistory();
    clearLatencySamples();
    clearRecoveryEvidence();
    delete (window as Window & { __c64uDiagnosticsTestBridge?: unknown }).__c64uDiagnosticsTestBridge;
    delete (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled;
  });

  it("seeds analytics snapshots through the window bridge when test probes are enabled", () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    const now = Date.now();

    registerDiagnosticsTestBridge();

    const bridge = (
      window as Window & {
        __c64uDiagnosticsTestBridge?: {
          seedAnalytics: (payload: {
            healthHistory: Array<Record<string, unknown>>;
            latencySamples: Array<Record<string, unknown>>;
            recoveryEvents: Array<Record<string, unknown>>;
          }) => void;
          getAnalyticsSnapshot: () => {
            healthHistory: Array<Record<string, unknown>>;
            latencySamples: Array<Record<string, unknown>>;
            recoveryEvents: Array<Record<string, unknown>>;
          };
          seedOverlayState: (payload: Record<string, unknown>) => void;
          getOverlayStateSnapshot: () => Record<string, unknown>;
        };
      }
    ).__c64uDiagnosticsTestBridge;

    expect(bridge).toBeDefined();

    bridge?.seedAnalytics({
      healthHistory: [
        {
          timestamp: new Date(now).toISOString(),
          overallHealth: "Healthy",
          durationMs: 210,
          probes: {
            rest: { outcome: "Success", durationMs: 50, reason: null },
            jiffy: { outcome: "Success", durationMs: 30, reason: null },
            raster: { outcome: "Success", durationMs: 25, reason: null },
            config: { outcome: "Success", durationMs: 60, reason: null },
            ftp: { outcome: "Success", durationMs: 45, reason: null },
            telnet: { outcome: "Success", durationMs: 35, reason: null },
          },
          latency: { p50: 52, p90: 75, p99: 96 },
        },
      ],
      latencySamples: [
        {
          timestampMs: now,
          durationMs: 84,
          transport: "REST",
          endpoint: "Info",
          path: "/v1/info",
        },
      ],
      recoveryEvents: [
        {
          timestamp: new Date(now - 30_000).toISOString(),
          kind: "retry-connection",
          outcome: "success",
          contributor: "REST",
          target: "c64u",
          message: "Recovered after transient timeout",
        },
      ],
    });

    const snapshot = bridge?.getAnalyticsSnapshot();
    expect(snapshot?.healthHistory).toHaveLength(1);
    expect(snapshot?.latencySamples).toHaveLength(1);
    expect(snapshot?.latencySamples[0]?.transport).toBe("REST");
    expect(snapshot?.recoveryEvents).toHaveLength(1);
    expect(snapshot?.recoveryEvents[0]?.message).toBe("Recovered after transient timeout");

    bridge?.seedOverlayState({
      healthCheckRunning: false,
      lastHealthCheckResult: {
        runId: "hc-seed-001",
        startTimestamp: new Date(now - 60_000).toISOString(),
        endTimestamp: new Date(now - 59_500).toISOString(),
        totalDurationMs: 500,
        overallHealth: "Healthy",
        probes: {
          REST: { probe: "REST", outcome: "Success", durationMs: 50, reason: null, startMs: now - 60_000 },
          FTP: { probe: "FTP", outcome: "Success", durationMs: 90, reason: null, startMs: now - 59_900 },
          TELNET: { probe: "TELNET", outcome: "Success", durationMs: 95, reason: null, startMs: now - 59_850 },
          CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 140, reason: null, startMs: now - 59_800 },
          RASTER: { probe: "RASTER", outcome: "Success", durationMs: 60, reason: null, startMs: now - 59_700 },
          JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 70, reason: null, startMs: now - 59_600 },
        },
        latency: { p50: 52, p90: 75, p99: 96 },
        deviceInfo: {
          firmware: "3.10b1",
          fpga: "1.42",
          core: "2024.03",
          uptimeSeconds: 7200,
          product: "C64 Ultimate",
        },
      },
    });

    const overlaySnapshot = bridge?.getOverlayStateSnapshot();
    expect(overlaySnapshot?.healthCheckRunning).toBe(false);
    expect(overlaySnapshot?.lastHealthCheckResult).toBeTruthy();
  });

  it("does not expose the bridge when test probes are disabled", () => {
    registerDiagnosticsTestBridge();

    expect((window as Window & { __c64uDiagnosticsTestBridge?: unknown }).__c64uDiagnosticsTestBridge).toBeUndefined();
  });

  it("clears seeded analytics and overlay state and reuses the same bridge instance", () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    const now = Date.now();

    registerDiagnosticsTestBridge();
    const firstBridge = window.__c64uDiagnosticsTestBridge;
    registerDiagnosticsTestBridge();

    expect(window.__c64uDiagnosticsTestBridge).toBe(firstBridge);

    const overlayEvents: Array<Record<string, unknown>> = [];
    const handleOverlayState = (event: Event) => {
      overlayEvents.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener(DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT, handleOverlayState);

    firstBridge?.seedAnalytics({
      healthHistory: [
        {
          timestamp: new Date(now).toISOString(),
          overallHealth: "Healthy",
          durationMs: 180,
          probes: {
            rest: { outcome: "Success", durationMs: 30, reason: null },
            jiffy: { outcome: "Success", durationMs: 25, reason: null },
            raster: { outcome: "Success", durationMs: 20, reason: null },
            config: { outcome: "Success", durationMs: 50, reason: null },
            ftp: { outcome: "Success", durationMs: 55, reason: null },
            telnet: { outcome: "Success", durationMs: 40, reason: null },
          },
          latency: { p50: 40, p90: 60, p99: 80 },
        },
      ],
      latencySamples: [
        {
          timestampMs: now,
          durationMs: 42,
          transport: "REST",
          endpoint: "Info",
          path: "/v1/info",
        },
      ],
      recoveryEvents: [
        {
          timestamp: new Date(now - 5_000).toISOString(),
          kind: "retry-connection",
          outcome: "success",
          contributor: "REST",
          target: "c64u",
          message: "Recovered quickly",
        },
      ],
    });
    firstBridge?.seedOverlayState({
      healthCheckRunning: true,
    });

    firstBridge?.clearAnalytics();
    expect(firstBridge?.getAnalyticsSnapshot()).toEqual({
      healthHistory: [],
      latencySamples: [],
      recoveryEvents: [],
    });

    firstBridge?.clearOverlayState();
    expect(firstBridge?.getOverlayStateSnapshot()).toEqual({
      lastHealthCheckResult: null,
      liveHealthCheckProbes: null,
      healthCheckRunning: false,
    });
    expect(overlayEvents.at(-1)).toEqual({
      lastHealthCheckResult: null,
      liveHealthCheckProbes: null,
      healthCheckRunning: false,
    });

    window.removeEventListener(DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT, handleOverlayState);
  });
});
