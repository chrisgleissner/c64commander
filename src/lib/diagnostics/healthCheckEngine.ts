/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// §11 — Deterministic health check system.
//
// Execution order (strict sequential, no retries, no parallelism):
//   REST → JIFFY → RASTER → CONFIG → FTP
//
// Each probe is recorded with outcome, duration, and skip/fail reason.

import { getC64API } from "@/lib/c64api";
import { listFtpDirectory } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { rollUpHealth, deriveConnectivityState } from "@/lib/diagnostics/healthModel";
import type { HealthState } from "@/lib/diagnostics/healthModel";
import {
  pushHealthHistoryEntry,
  type HealthCheckProbeOutcome,
  type HealthCheckProbeResult,
  type HealthHistoryEntry,
} from "@/lib/diagnostics/healthHistory";
import { computeLatencyPercentiles } from "@/lib/diagnostics/latencyTracker";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";

// §11.3 — CONFIG roundtrip mutation targets in priority order
const CONFIG_ROUNDTRIP_TARGETS = [
  { category: "LED Strip Settings", item: "Strip Intensity", delta: 1, min: 0, max: 31 },
  { category: "Audio Mixer", item: "Vol UltiSid 1", delta: 1, min: -64, max: 0 },
] as const;

const FTP_PROBE_TIMEOUT_MS = 1000; // §11.3

export type HealthCheckProbeType = "REST" | "JIFFY" | "RASTER" | "CONFIG" | "FTP";

export type HealthCheckProbeRecord = HealthCheckProbeResult & {
  probe: HealthCheckProbeType;
  startMs: number;
};

export type HealthCheckRunResult = {
  runId: string;
  startTimestamp: string;
  endTimestamp: string;
  totalDurationMs: number;
  overallHealth: HealthState;
  probes: Record<HealthCheckProbeType, HealthCheckProbeRecord>;
  latency: { p50: number; p90: number; p99: number };
  /** Firmware/FPGA/core/uptime data captured during the REST probe */
  deviceInfo?: {
    firmware: string | null;
    fpga: string | null;
    core: string | null;
    uptimeSeconds: number | null;
    product: string | null;
  };
};

let running = false;

const timedProbe = async <T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> => {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
};

const makeRecord = (
  probe: HealthCheckProbeType,
  outcome: HealthCheckProbeOutcome,
  durationMs: number | null,
  reason: string | null,
  startMs: number,
): HealthCheckProbeRecord => ({ probe, outcome, durationMs, reason, startMs });

/** §11.3 REST probe: GET /v1/info */
const probeRest = async (): Promise<{
  record: HealthCheckProbeRecord;
  deviceInfo: HealthCheckRunResult["deviceInfo"];
}> => {
  const startMs = Date.now();
  try {
    const api = getC64API();
    const { result: info, durationMs } = await timedProbe(() =>
      api.getInfo({
        __c64uIntent: "system",
        __c64uBypassCache: true,
        __c64uBypassCooldown: true,
        __c64uBypassBackoff: true,
      }),
    );
    const hasErrors = Array.isArray(info.errors) && info.errors.length > 0;
    const hasProduct = typeof info.product === "string" && info.product.trim().length > 0;
    const outcome: HealthCheckProbeOutcome = hasErrors || !hasProduct ? "Fail" : "Success";
    const reason = hasErrors
      ? `Device errors: ${info.errors.slice(0, 2).join(", ")}`
      : !hasProduct
        ? "No product info in response"
        : null;
    const deviceInfo: HealthCheckRunResult["deviceInfo"] = {
      firmware: info.firmware_version ?? null,
      fpga: info.fpga_version ?? null,
      core: info.core_version ?? null,
      uptimeSeconds: null, // populated by JIFFY probe
      product: info.product ?? null,
    };
    return {
      record: makeRecord("REST", outcome, durationMs, reason, startMs),
      deviceInfo,
    };
  } catch (error) {
    const msg = (error as Error).message;
    addLog("warn", "Health check REST probe failed", { error: msg });
    return {
      record: makeRecord("REST", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs),
      deviceInfo: undefined,
    };
  }
};

/** §11.3 JIFFY probe: read jiffy clock from C64 memory 0x00A2 (3 bytes) */
const probeJiffy = async (): Promise<{
  record: HealthCheckProbeRecord;
  uptimeSeconds: number | null;
}> => {
  const startMs = Date.now();
  try {
    const api = getC64API();
    const { result: bytes, durationMs } = await timedProbe(() => api.readMemory("00A2", 3));
    if (!bytes || bytes.length !== 3) {
      return {
        record: makeRecord(
          "JIFFY",
          "Fail",
          Date.now() - startMs,
          `Expected 3 bytes, got ${bytes?.length ?? 0}`,
          startMs,
        ),
        uptimeSeconds: null,
      };
    }
    const jiffy = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
    const uptimeSeconds = Math.floor(jiffy / 60);
    return {
      record: makeRecord("JIFFY", "Success", durationMs, null, startMs),
      uptimeSeconds,
    };
  } catch (error) {
    const msg = (error as Error).message;
    addLog("warn", "Health check JIFFY probe failed", { error: msg });
    return {
      record: makeRecord("JIFFY", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs),
      uptimeSeconds: null,
    };
  }
};

/** §11.3 RASTER probe: read raster scan register D012 (optional capability) */
const probeRaster = async (): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();
  try {
    const api = getC64API();
    const { result: bytes, durationMs } = await timedProbe(() => api.readMemory("D012", 1));
    if (!bytes || bytes.length < 1) {
      // Skipped — device does not expose raster register (considered unsupported)
      return makeRecord("RASTER", "Skipped", null, "Raster register unavailable", startMs);
    }
    return makeRecord("RASTER", "Success", durationMs, null, startMs);
  } catch (error) {
    const msg = (error as Error).message;
    // §11.4 — Fail only if the check was attempted and should have worked
    // Non-fatal: treat unexpectedly as Skipped with note
    addLog("debug", "Health check RASTER probe skipped", { error: msg });
    return makeRecord("RASTER", "Skipped", null, `Unsupported: ${msg.slice(0, 60)}`, startMs);
  }
};

/** §11.3 CONFIG probe: safe write-read-revert roundtrip */
const probeConfig = async (): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();
  const api = getC64API();

  for (const target of CONFIG_ROUNDTRIP_TARGETS) {
    try {
      // Step 1: read current value
      const readResp = await api.getConfigItem(target.category, target.item, {
        __c64uIntent: "system",
        __c64uBypassCache: true,
      });
      const categoryData = readResp[target.category];
      if (!categoryData || typeof categoryData !== "object") continue;

      const itemData = (categoryData as Record<string, unknown>)[target.item];
      let currentValue: number | null = null;

      if (typeof itemData === "number") {
        currentValue = itemData;
      } else if (itemData && typeof itemData === "object" && "selected" in itemData) {
        const sel = (itemData as { selected?: string | number }).selected;
        currentValue = typeof sel === "number" ? sel : typeof sel === "string" ? parseFloat(sel) : null;
      }

      if (currentValue === null || !Number.isFinite(currentValue)) continue;

      // Step 2: write temporary value (small delta, clamped to range)
      const tempValue =
        currentValue < target.max
          ? Math.min(currentValue + target.delta, target.max)
          : Math.max(currentValue - target.delta, target.min);

      await api.setConfigValue(target.category, target.item, tempValue);

      // Step 3: read back
      const readBackResp = await api.getConfigItem(target.category, target.item, {
        __c64uIntent: "system",
        __c64uBypassCache: true,
      });
      const readBackCategory = readBackResp[target.category];
      const readBackItem = readBackCategory ? (readBackCategory as Record<string, unknown>)[target.item] : null;
      let readBackValue: number | null = null;
      if (typeof readBackItem === "number") {
        readBackValue = readBackItem;
      } else if (readBackItem && typeof readBackItem === "object" && "selected" in readBackItem) {
        const sel = (readBackItem as { selected?: string | number }).selected;
        readBackValue = typeof sel === "number" ? sel : typeof sel === "string" ? parseFloat(sel) : null;
      }

      // Step 4: revert to original value
      await api.setConfigValue(target.category, target.item, currentValue);

      // Step 5: verify revert
      const verifyResp = await api.getConfigItem(target.category, target.item, {
        __c64uIntent: "system",
        __c64uBypassCache: true,
      });
      const verifyCategory = verifyResp[target.category];
      const verifyItem = verifyCategory ? (verifyCategory as Record<string, unknown>)[target.item] : null;
      let verifyValue: number | null = null;
      if (typeof verifyItem === "number") {
        verifyValue = verifyItem;
      } else if (verifyItem && typeof verifyItem === "object" && "selected" in verifyItem) {
        const sel = (verifyItem as { selected?: string | number }).selected;
        verifyValue = typeof sel === "number" ? sel : typeof sel === "string" ? parseFloat(sel) : null;
      }

      if (readBackValue !== tempValue) {
        return makeRecord(
          "CONFIG",
          "Fail",
          Date.now() - startMs,
          `Readback mismatch: expected ${tempValue}, got ${readBackValue}`,
          startMs,
        );
      }
      if (verifyValue !== currentValue) {
        return makeRecord(
          "CONFIG",
          "Fail",
          Date.now() - startMs,
          `Post-revert mismatch: expected ${currentValue}, got ${verifyValue}`,
          startMs,
        );
      }

      return makeRecord("CONFIG", "Success", Date.now() - startMs, null, startMs);
    } catch (error) {
      const msg = (error as Error).message;
      addLog("warn", "Health check CONFIG probe failed", {
        category: target.category,
        item: target.item,
        error: msg,
      });
      return makeRecord("CONFIG", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs);
    }
  }

  // No suitable target found — skip
  return makeRecord("CONFIG", "Skipped", null, "No suitable config roundtrip target available", startMs);
};

/** §11.3 FTP probe: LIST / with 1000 ms timeout */
const probeFtp = async (): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();
  try {
    const snap = getC64APIConfigSnapshot();
    const host = snap.deviceHost;
    const port = getStoredFtpPort();
    const { durationMs } = await timedProbe(() =>
      listFtpDirectory({
        host,
        port,
        path: "/",
        timeoutMs: FTP_PROBE_TIMEOUT_MS,
        __c64uIntent: "system",
      }),
    );
    return makeRecord("FTP", "Success", durationMs, null, startMs);
  } catch (error) {
    const msg = (error as Error).message;
    addLog("warn", "Health check FTP probe failed", { error: msg });
    return makeRecord("FTP", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs);
  }
};

const generateRunId = (): string => `hcr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Run one complete health check pass.
 *
 * §11.1 — Sequential execution: REST → JIFFY → RASTER → CONFIG → FTP.
 * §11.1 — No retries, no parallelism, no hidden state.
 * §11.4 — Dependent probes are skipped with an explicit reason when a
 *         prerequisite probe failed.
 *
 * @returns The full run result, or null if a run was already in progress.
 */
export const runHealthCheck = async (): Promise<HealthCheckRunResult | null> => {
  if (running) {
    addLog("debug", "Health check skipped: run already in progress");
    return null;
  }
  running = true;
  const runId = generateRunId();
  const startTimestamp = new Date().toISOString();
  const runStartMs = Date.now();

  try {
    addLog("info", "Health check started", { runId });

    // REST probe
    const { record: restRecord, deviceInfo } = await probeRest();
    const restFailed = restRecord.outcome === "Fail";

    // JIFFY probe (may skip if REST failed)
    let jiffyRecord: HealthCheckProbeRecord;
    let uptimeSeconds: number | null = null;
    if (restFailed) {
      jiffyRecord = makeRecord("JIFFY", "Skipped", null, "Skipped: REST probe failed", Date.now());
    } else {
      const r = await probeJiffy();
      jiffyRecord = r.record;
      uptimeSeconds = r.uptimeSeconds;
    }

    // RASTER probe (may skip if REST failed)
    let rasterRecord: HealthCheckProbeRecord;
    if (restFailed) {
      rasterRecord = makeRecord("RASTER", "Skipped", null, "Skipped: REST probe failed", Date.now());
    } else {
      rasterRecord = await probeRaster();
    }

    // CONFIG probe (may skip if REST failed)
    let configRecord: HealthCheckProbeRecord;
    if (restFailed) {
      configRecord = makeRecord("CONFIG", "Skipped", null, "Skipped: REST probe failed", Date.now());
    } else {
      configRecord = await probeConfig();
    }

    // FTP probe — runs independently of REST/JIFFY
    const ftpRecord = await probeFtp();

    const endTimestamp = new Date().toISOString();
    const totalDurationMs = Date.now() - runStartMs;

    // §10.4 — Overall health from probe outcomes
    const probeToHealth = (r: HealthCheckProbeRecord): "Healthy" | "Degraded" | "Idle" => {
      if (r.outcome === "Success") return "Healthy";
      if (r.outcome === "Skipped") return "Idle";
      return "Degraded";
    };

    const contributors = {
      App: {
        state:
          probeToHealth(jiffyRecord) === "Degraded" || probeToHealth(configRecord) === "Degraded"
            ? ("Degraded" as const)
            : probeToHealth(jiffyRecord) === "Idle" && probeToHealth(configRecord) === "Idle"
              ? ("Idle" as const)
              : ("Healthy" as const),
        problemCount: 0,
        totalOperations: 0,
        failedOperations: 0,
      },
      REST: {
        state:
          restRecord.outcome === "Fail"
            ? ("Unhealthy" as const)
            : restRecord.outcome === "Success"
              ? ("Healthy" as const)
              : ("Idle" as const),
        problemCount: 0,
        totalOperations: 0,
        failedOperations: 0,
      },
      FTP: {
        state:
          ftpRecord.outcome === "Fail"
            ? ("Unhealthy" as const)
            : ftpRecord.outcome === "Success"
              ? ("Healthy" as const)
              : ("Idle" as const),
        problemCount: 0,
        totalOperations: 0,
        failedOperations: 0,
      },
    };

    const connectionState = getConnectionSnapshot().state;
    const connectivity = deriveConnectivityState(connectionState);
    const overallHealth = rollUpHealth(contributors, connectivity);

    const latency = computeLatencyPercentiles();

    const probes = {
      REST: restRecord,
      JIFFY: jiffyRecord,
      RASTER: rasterRecord,
      CONFIG: configRecord,
      FTP: ftpRecord,
    };

    const result: HealthCheckRunResult = {
      runId,
      startTimestamp,
      endTimestamp,
      totalDurationMs,
      overallHealth,
      probes,
      latency: { p50: latency.p50, p90: latency.p90, p99: latency.p99 },
      deviceInfo: deviceInfo ? { ...deviceInfo, uptimeSeconds } : undefined,
    };

    // §13.1 — Push to health history ring buffer
    pushHealthHistoryEntry({
      timestamp: startTimestamp,
      overallHealth,
      durationMs: totalDurationMs,
      probes: {
        rest: { outcome: restRecord.outcome, durationMs: restRecord.durationMs, reason: restRecord.reason },
        jiffy: { outcome: jiffyRecord.outcome, durationMs: jiffyRecord.durationMs, reason: jiffyRecord.reason },
        raster: { outcome: rasterRecord.outcome, durationMs: rasterRecord.durationMs, reason: rasterRecord.reason },
        config: { outcome: configRecord.outcome, durationMs: configRecord.durationMs, reason: configRecord.reason },
        ftp: { outcome: ftpRecord.outcome, durationMs: ftpRecord.durationMs, reason: ftpRecord.reason },
      },
      latency: result.latency,
    });

    addLog("info", "Health check completed", {
      runId,
      overallHealth,
      durationMs: totalDurationMs,
      outcomes: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.outcome])),
    });

    return result;
  } catch (error) {
    const msg = (error as Error).message;
    addLog("error", "Health check run failed unexpectedly", {
      runId,
      error: msg,
      stack: (error as Error).stack,
    });
    throw error;
  } finally {
    running = false;
  }
};

/** Whether a health check is currently in progress. */
export const isHealthCheckRunning = (): boolean => running;
