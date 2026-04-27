/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { C64API, getC64API, getC64APIConfigSnapshot } from "@/lib/c64api";
import {
  appendHealthCheckTransition,
  getHealthCheckStateSnapshot,
  resetHealthCheckProbeStates,
  setHealthCheckStateSnapshot,
  type HealthCheckProbeExecutionState,
  type HealthCheckProbeLifecycle,
  type HealthCheckRunLifecycle,
} from "@/lib/diagnostics/healthCheckState";
import { listFtpDirectory } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { addLog } from "@/lib/logging";
import { createTelnetClient } from "@/lib/telnet/telnetClient";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { buildBaseUrlFromDeviceHost, stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { rollUpHealth, deriveConnectivityState } from "@/lib/diagnostics/healthModel";
import type { ConnectivityState, HealthState } from "@/lib/diagnostics/healthModel";
import {
  pushHealthHistoryEntry,
  type HealthCheckProbeOutcome,
  type HealthCheckProbeResult,
} from "@/lib/diagnostics/healthHistory";
import { computeLatencyPercentiles } from "@/lib/diagnostics/latencyTracker";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";

const CONFIG_ROUNDTRIP_TARGETS = [
  { category: "LED Strip Settings", item: "Strip Intensity", delta: 16, min: 0, max: 31 },
  { category: "Keyboard Lighting", item: "Strip Intensity", delta: 16, min: 0, max: 31 },
  { category: "Audio Mixer", item: "Vol UltiSid 1", delta: 16, min: -64, max: 0 },
  { category: "Audio Mixer", item: "Vol Drive 1", delta: 16, min: -64, max: 0 },
] as const;

const PROBE_TIMEOUT_MS: Record<HealthCheckProbeType, number> = {
  REST: 3000,
  FTP: 1000,
  TELNET: 3000,
  CONFIG: 4000,
  RASTER: 1500,
  JIFFY: 1500,
};

const GLOBAL_RUN_TIMEOUT_MS = 12_000;
const STALE_RUN_GRACE_MS = 1500;
const PRESENTATION_ORDER: ReadonlyArray<HealthCheckProbeType> = ["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY"];
const CONFIG_PULSE_DELAY_MS = 80;
const TELNET_READ_RETRY_ATTEMPTS = 5;
const TELNET_READ_RETRY_DELAY_MS = 80;

export type HealthCheckProbeType = "REST" | "JIFFY" | "RASTER" | "CONFIG" | "FTP" | "TELNET";

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
  connectivity: ConnectivityState;
  probes: Record<HealthCheckProbeType, HealthCheckProbeRecord>;
  latency: { p50: number; p90: number; p99: number };
  deviceInfo?: {
    firmware: string | null;
    fpga: string | null;
    core: string | null;
    uptimeSeconds: number | null;
    product: string | null;
  };
};

export type HealthCheckTarget = {
  deviceHost: string;
  ftpPort: number;
  telnetPort: number;
  password?: string | null;
};

export type HealthCheckTargetRunMode = "full" | "passive";

export type HealthCheckProgressSnapshot = {
  liveProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>>;
  probeStates: Record<HealthCheckProbeType, HealthCheckProbeExecutionState>;
};

type ActiveRun = {
  token: symbol;
  runId: string;
  controller: AbortController;
  startedAtMs: number;
  deadlineMs: number;
};

type ProbeExecution = {
  record: HealthCheckProbeRecord;
  lifecycle: Extract<HealthCheckProbeLifecycle, "SUCCESS" | "FAILED" | "TIMEOUT" | "CANCELLED">;
  uptimeSeconds?: number | null;
  deviceInfo?: HealthCheckRunResult["deviceInfo"];
};

type ProbeRuntime = {
  api: Pick<C64API, "getInfo" | "readMemory" | "getConfigItem" | "setConfigValue">;
  host: string;
  ftpPort: number;
  telnetPort: number;
  password?: string;
};

let activeRun: ActiveRun | null = null;
let runSequence = 0;

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

const generateRunId = (): string => {
  runSequence += 1;
  return `hcr-${runSequence.toString().padStart(4, "0")}`;
};

const buildProbeRuntime = (target?: HealthCheckTarget): ProbeRuntime => {
  if (target) {
    const deviceHost = target.deviceHost;
    return {
      api: new C64API(buildBaseUrlFromDeviceHost(deviceHost), target.password ?? undefined, deviceHost),
      host: stripPortFromDeviceHost(deviceHost),
      ftpPort: target.ftpPort,
      telnetPort: target.telnetPort,
      password: target.password ?? undefined,
    };
  }

  const api = getC64API();
  const snap = getC64APIConfigSnapshot();
  return {
    api,
    host: stripPortFromDeviceHost(snap.deviceHost),
    ftpPort: getStoredFtpPort(),
    telnetPort: getStoredTelnetPort(),
    password: snap.password,
  };
};

const parseTimestampMs = (value: string | null) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isAbortLike = (error: unknown) => {
  const name = (error as { name?: string } | undefined)?.name;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return name === "AbortError" || /aborted/i.test(message);
};

const isTimeoutLike = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timed out/i.test(message);
};

const buildProbeStates = () => resetHealthCheckProbeStates();

const setRunLifecycle = (
  nextState: HealthCheckRunLifecycle,
  reason: string | null,
  extra: Record<string, unknown> = {},
) => {
  const snapshot = getHealthCheckStateSnapshot();
  if (snapshot.runState !== nextState) {
    appendHealthCheckTransition({
      timestamp: new Date().toISOString(),
      scope: "run",
      target: snapshot.currentRunId ?? "health-check",
      from: snapshot.runState,
      to: nextState,
      reason,
    });
  }
  setHealthCheckStateSnapshot({
    runState: nextState,
    running: nextState === "RUNNING",
    lastTransitionReason: reason,
    ...(extra as Partial<typeof snapshot>),
  });
};

const setProbeLifecycle = (
  probe: HealthCheckProbeType,
  nextState: HealthCheckProbeLifecycle,
  updates: Partial<HealthCheckProbeExecutionState>,
  reason: string | null,
) => {
  const snapshot = getHealthCheckStateSnapshot();
  const current = snapshot.probeStates[probe];
  if (current.state !== nextState) {
    appendHealthCheckTransition({
      timestamp: new Date().toISOString(),
      scope: "probe",
      target: probe,
      from: current.state,
      to: nextState,
      reason,
    });
  }
  setHealthCheckStateSnapshot({
    probeStates: {
      ...snapshot.probeStates,
      [probe]: {
        ...current,
        ...updates,
        state: nextState,
        reason,
      },
    },
  });
};

const updateLiveProbes = (next: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null) => {
  setHealthCheckStateSnapshot({ liveProbes: next });
};

const isCurrentRun = (token: symbol) => activeRun?.token === token;

const markTerminalProbeStates = (
  terminalState: Extract<HealthCheckProbeLifecycle, "TIMEOUT" | "CANCELLED">,
  reason: string,
) => {
  const snapshot = getHealthCheckStateSnapshot();
  const endedAt = new Date().toISOString();
  const liveProbes = { ...(snapshot.liveProbes ?? {}) };

  PRESENTATION_ORDER.forEach((probe) => {
    const current = snapshot.probeStates[probe];
    if (current.state === "RUNNING" || current.state === "PENDING") {
      const startedAtMs = parseTimestampMs(current.startedAt) ?? Date.now();
      const durationMs = terminalState === "TIMEOUT" ? Math.max(0, Date.now() - startedAtMs) : null;
      const record =
        liveProbes[probe] ??
        makeRecord(probe, terminalState === "TIMEOUT" ? "Fail" : "Skipped", durationMs, reason, startedAtMs);
      liveProbes[probe] = record;
      setProbeLifecycle(
        probe,
        terminalState,
        {
          outcome: record.outcome,
          endedAt,
          durationMs: record.durationMs,
        },
        reason,
      );
    }
  });

  updateLiveProbes(liveProbes);
};

const cancelActiveRun = (
  terminalState: Extract<HealthCheckRunLifecycle, "CANCELLED" | "TIMEOUT">,
  reason: string,
): boolean => {
  const current = activeRun;
  if (!current) return false;
  current.controller.abort(reason);
  activeRun = null;
  markTerminalProbeStates(terminalState === "TIMEOUT" ? "TIMEOUT" : "CANCELLED", reason);
  setRunLifecycle(terminalState, reason, {
    endedAt: new Date().toISOString(),
    staleAfterMs: null,
  });
  return true;
};

const withTimeout = async <T>(run: () => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const waitMs = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener("abort", handleAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

const extractConfigItemData = (resp: Record<string, unknown>, category: string, item: string): unknown | null => {
  const categoryData = resp[category];
  if (!categoryData || typeof categoryData !== "object") return null;
  const catRecord = categoryData as Record<string, unknown>;
  const itemsBlock = catRecord.items;
  if (itemsBlock && typeof itemsBlock === "object") {
    return (itemsBlock as Record<string, unknown>)[item] ?? null;
  }
  return catRecord[item] ?? null;
};

const parseConfigNumericValue = (itemData: unknown): number | null => {
  if (typeof itemData === "number") return Number.isFinite(itemData) ? itemData : null;
  if (!itemData || typeof itemData !== "object") return null;

  const obj = itemData as Record<string, unknown>;
  const selected = obj.selected;
  const current = obj.current;

  if (typeof selected === "string") {
    const options = Array.isArray(obj.options) ? obj.options : null;
    if (options) {
      const idx = options.indexOf(selected);
      if (idx >= 0) return idx;
    }
  }

  if (typeof selected === "number") return Number.isFinite(selected) ? selected : null;

  if (typeof selected === "string") {
    const parsed = parseFloat(selected);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (typeof current === "string") {
    const values = Array.isArray(obj.values) ? obj.values : null;
    if (values) {
      const idx = values.indexOf(current);
      if (idx >= 0) return idx;
    }
    const parsed = parseFloat(current);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (typeof current === "number") return Number.isFinite(current) ? current : null;

  return null;
};

const getConfigRoundtripBounds = (
  itemData: unknown,
  fallback: Pick<(typeof CONFIG_ROUNDTRIP_TARGETS)[number], "min" | "max">,
): { min: number; max: number } => {
  if (!itemData || typeof itemData !== "object") {
    return fallback;
  }

  const obj = itemData as Record<string, unknown>;
  const selected = obj.selected;
  const current = obj.current;
  const options = Array.isArray(obj.options) ? obj.options : null;
  const values = Array.isArray(obj.values) ? obj.values : null;
  const min = typeof obj.min === "number" && Number.isFinite(obj.min) ? obj.min : null;
  const max = typeof obj.max === "number" && Number.isFinite(obj.max) ? obj.max : null;

  if (typeof selected === "string" && options) {
    const idx = options.indexOf(selected);
    if (idx >= 0) {
      return { min: 0, max: options.length - 1 };
    }
  }

  if (typeof current === "string" && values) {
    const idx = values.indexOf(current);
    if (idx >= 0) {
      return { min: 0, max: values.length - 1 };
    }
  }

  if (min !== null && max !== null && min <= max) {
    return { min, max };
  }

  return fallback;
};

const selectConfigPulseValue = (currentValue: number, delta: number, bounds: { min: number; max: number }) => {
  if (currentValue + delta <= bounds.max) return currentValue + delta;
  if (currentValue - delta >= bounds.min) return currentValue - delta;

  const upwardRoom = bounds.max - currentValue;
  const downwardRoom = currentValue - bounds.min;
  if (upwardRoom >= downwardRoom) return bounds.max;
  return bounds.min;
};

const probeRest = async (
  signal: AbortSignal,
  runtime: ProbeRuntime,
): Promise<{
  record: HealthCheckProbeRecord;
  deviceInfo: HealthCheckRunResult["deviceInfo"];
}> => {
  const startMs = Date.now();
  try {
    const { result: info, durationMs } = await timedProbe(() =>
      runtime.api.getInfo({
        signal,
        timeoutMs: PROBE_TIMEOUT_MS.REST,
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
    return {
      record: makeRecord("REST", outcome, durationMs, reason, startMs),
      deviceInfo: {
        firmware: info.firmware_version ?? null,
        fpga: info.fpga_version ?? null,
        core: info.core_version ?? null,
        uptimeSeconds: null,
        product: info.product ?? null,
      },
    };
  } catch (error) {
    if (isAbortLike(error) || isTimeoutLike(error)) {
      throw error;
    }
    const msg = (error as Error).message;
    addLog("warn", "Health check REST probe failed", { error: msg });
    return {
      record: makeRecord("REST", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs),
      deviceInfo: undefined,
    };
  }
};

const probeJiffy = async (
  signal: AbortSignal,
  runtime: ProbeRuntime,
): Promise<{
  record: HealthCheckProbeRecord;
  uptimeSeconds: number | null;
}> => {
  const startMs = Date.now();
  try {
    const { result: bytes, durationMs } = await timedProbe(() =>
      runtime.api.readMemory("00A2", 3, { signal, timeoutMs: PROBE_TIMEOUT_MS.JIFFY }),
    );
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
    return {
      record: makeRecord("JIFFY", "Success", durationMs, null, startMs),
      uptimeSeconds: Math.floor(jiffy / 60),
    };
  } catch (error) {
    if (isAbortLike(error) || isTimeoutLike(error)) {
      throw error;
    }
    const msg = (error as Error).message;
    addLog("warn", "Health check JIFFY probe failed", { error: msg });
    return {
      record: makeRecord("JIFFY", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs),
      uptimeSeconds: null,
    };
  }
};

const probeRaster = async (signal: AbortSignal, runtime: ProbeRuntime): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();
  try {
    const { result: bytes, durationMs } = await timedProbe(() =>
      runtime.api.readMemory("D012", 1, { signal, timeoutMs: PROBE_TIMEOUT_MS.RASTER }),
    );
    if (!bytes || bytes.length < 1) {
      return makeRecord("RASTER", "Skipped", null, "Raster register unavailable", startMs);
    }
    return makeRecord("RASTER", "Success", durationMs, null, startMs);
  } catch (error) {
    if (isAbortLike(error) || isTimeoutLike(error)) {
      throw error;
    }
    const msg = (error as Error).message;
    addLog("debug", "Health check RASTER probe skipped", { error: msg });
    return makeRecord("RASTER", "Skipped", null, `Unsupported: ${msg.slice(0, 60)}`, startMs);
  }
};

const probeConfig = async (signal: AbortSignal, runtime: ProbeRuntime): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();

  for (const target of CONFIG_ROUNDTRIP_TARGETS) {
    try {
      const readResp = await runtime.api.getConfigItem(target.category, target.item, {
        signal,
        timeoutMs: PROBE_TIMEOUT_MS.CONFIG,
        __c64uIntent: "system",
        __c64uBypassCache: true,
      });
      const itemData = extractConfigItemData(readResp, target.category, target.item);
      if (itemData === null) {
        addLog("debug", "Health check CONFIG probe: item not found in response", {
          category: target.category,
          item: target.item,
          responseKeys: Object.keys(readResp),
        });
        continue;
      }

      const currentValue = parseConfigNumericValue(itemData);
      if (currentValue === null || !Number.isFinite(currentValue)) {
        addLog("debug", "Health check CONFIG probe: non-numeric value", {
          category: target.category,
          item: target.item,
          itemData: JSON.stringify(itemData).slice(0, 120),
        });
        continue;
      }

      const bounds = getConfigRoundtripBounds(itemData, target);
      const tempValue = selectConfigPulseValue(currentValue, target.delta, bounds);
      if (tempValue === currentValue) {
        addLog("debug", "Health check CONFIG probe: no pulse headroom for target", {
          category: target.category,
          item: target.item,
          currentValue,
          bounds,
        });
        continue;
      }

      addLog("debug", "Health check CONFIG probe: selected roundtrip target", {
        category: target.category,
        item: target.item,
        currentValue,
        tempValue,
        bounds,
      });

      let readBackValue: number | null = null;
      let revertErrorMessage: string | null = null;
      let tempValueApplied = false;
      try {
        await runtime.api.setConfigValue(target.category, target.item, tempValue, {
          signal,
          timeoutMs: PROBE_TIMEOUT_MS.CONFIG,
        });
        tempValueApplied = true;
        await waitMs(CONFIG_PULSE_DELAY_MS, signal);

        const readBackResp = await runtime.api.getConfigItem(target.category, target.item, {
          signal,
          timeoutMs: PROBE_TIMEOUT_MS.CONFIG,
          __c64uIntent: "system",
          __c64uBypassCache: true,
        });
        readBackValue = parseConfigNumericValue(extractConfigItemData(readBackResp, target.category, target.item));
      } finally {
        if (tempValueApplied) {
          try {
            await runtime.api.setConfigValue(target.category, target.item, currentValue, {
              signal,
              timeoutMs: PROBE_TIMEOUT_MS.CONFIG,
            });
          } catch (error) {
            revertErrorMessage = error instanceof Error ? error.message : String(error ?? "Unknown revert failure");
            addLog("warn", "Health check CONFIG probe revert failed", {
              category: target.category,
              item: target.item,
              currentValue,
              error: revertErrorMessage,
            });
          }
        }
      }

      const verifyResp = await runtime.api.getConfigItem(target.category, target.item, {
        signal,
        timeoutMs: PROBE_TIMEOUT_MS.CONFIG,
        __c64uIntent: "system",
        __c64uBypassCache: true,
      });
      const verifyValue = parseConfigNumericValue(extractConfigItemData(verifyResp, target.category, target.item));

      addLog("debug", "Health check CONFIG probe: completed roundtrip", {
        category: target.category,
        item: target.item,
        currentValue,
        tempValue,
        readBackValue,
        verifyValue,
      });

      if (revertErrorMessage) {
        return makeRecord(
          "CONFIG",
          "Fail",
          Date.now() - startMs,
          `Failed to restore original value: ${revertErrorMessage}`.slice(0, 80),
          startMs,
        );
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
      if (isAbortLike(error) || isTimeoutLike(error)) {
        throw error;
      }
      const msg = (error as Error).message;
      addLog("warn", "Health check CONFIG probe failed", {
        category: target.category,
        item: target.item,
        error: msg,
      });
      return makeRecord("CONFIG", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs);
    }
  }

  return makeRecord("CONFIG", "Skipped", null, "No suitable config roundtrip target available", startMs);
};

const probeFtp = async (runtime: ProbeRuntime): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();
  try {
    const { result, durationMs } = await timedProbe(() =>
      listFtpDirectory({
        host: runtime.host,
        port: runtime.ftpPort,
        password: runtime.password,
        path: "/",
        timeoutMs: PROBE_TIMEOUT_MS.FTP,
        __c64uIntent: "system",
      }),
    );
    const hasEntries = Array.isArray(result) || (!!result && Array.isArray(result.entries));
    if (!hasEntries) {
      return makeRecord("FTP", "Fail", durationMs, "Invalid FTP listing payload", startMs);
    }
    return makeRecord("FTP", "Success", durationMs, null, startMs);
  } catch (error) {
    if (isTimeoutLike(error)) {
      throw error;
    }
    const msg = (error as Error).message;
    addLog("warn", "Health check FTP probe failed", { error: msg });
    return makeRecord("FTP", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs);
  }
};

const hasExpectedTelnetScreen = (titleLine: string): boolean => {
  const normalized = titleLine.trim().toLowerCase();
  return (
    normalized.includes("ultimate-ii+") || normalized.includes("c64 ultimate") || normalized.includes("ultimate 64")
  );
};

const probeTelnet = async (signal: AbortSignal, runtime: ProbeRuntime): Promise<HealthCheckProbeRecord> => {
  const startMs = Date.now();
  const session = createTelnetSession(createTelnetClient({ connectTimeoutMs: PROBE_TIMEOUT_MS.TELNET }));
  const readTimeoutMs = Math.max(150, Math.floor(PROBE_TIMEOUT_MS.TELNET / 8));

  try {
    await session.connect(runtime.host, runtime.telnetPort, runtime.password);
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let lastReason = "Unexpected blank Telnet screen";
    for (let attempt = 1; attempt <= TELNET_READ_RETRY_ATTEMPTS; attempt += 1) {
      const screen = await session.readScreen(readTimeoutMs);
      const titleLine = screen.titleLine.trim();
      const elapsedMs = Date.now() - startMs;
      addLog("debug", "Health check TELNET probe banner", {
        host: runtime.host,
        port: runtime.telnetPort,
        attempt,
        elapsedMs,
        titleLine: titleLine.slice(0, 120),
        screenType: screen.screenType,
        readTimeoutMs,
      });

      if (hasExpectedTelnetScreen(titleLine) && screen.screenType !== "unknown") {
        addLog("debug", "Health check TELNET probe accepted screen", {
          host: runtime.host,
          port: runtime.telnetPort,
          attempt,
          elapsedMs,
        });
        return makeRecord("TELNET", "Success", elapsedMs, null, startMs);
      }

      lastReason =
        titleLine.length > 0
          ? screen.screenType === "unknown"
            ? `Unrecognized Telnet screen: ${titleLine.slice(0, 80)}`
            : `Unexpected Telnet screen: ${titleLine.slice(0, 80)}`
          : "Unexpected blank Telnet screen";

      if (attempt < TELNET_READ_RETRY_ATTEMPTS) {
        await waitMs(TELNET_READ_RETRY_DELAY_MS, signal);
      }
    }

    return makeRecord("TELNET", "Fail", Date.now() - startMs, lastReason, startMs);
  } catch (error) {
    if (isAbortLike(error) || isTimeoutLike(error)) {
      throw error;
    }
    const msg = (error as Error).message;
    addLog("warn", "Health check TELNET probe failed", { error: msg });
    return makeRecord("TELNET", "Fail", Date.now() - startMs, msg.slice(0, 80), startMs);
  } finally {
    try {
      await session.disconnect();
    } catch (error) {
      addLog("warn", "Health check TELNET disconnect failed", {
        error: error instanceof Error ? error.message : String(error ?? "Unknown Telnet disconnect failure"),
      });
    }
  }
};

const lifecycleFromRecord = (
  outcome: HealthCheckProbeOutcome,
): Extract<HealthCheckProbeLifecycle, "SUCCESS" | "FAILED" | "CANCELLED"> => {
  if (outcome === "Success") return "SUCCESS";
  if (outcome === "Fail") return "FAILED";
  return "CANCELLED";
};

const runProbe = async <T>(
  run: ActiveRun,
  probe: HealthCheckProbeType,
  execute: (signal: AbortSignal) => Promise<T>,
  normalize: (value: T) => ProbeExecution,
): Promise<ProbeExecution> => {
  const startedAt = new Date().toISOString();
  setProbeLifecycle(
    probe,
    "RUNNING",
    {
      startedAt,
      endedAt: null,
      durationMs: null,
      outcome: null,
    },
    null,
  );

  const remainingBudgetMs = Math.max(1, run.deadlineMs - Date.now());
  const timeoutMs = Math.min(PROBE_TIMEOUT_MS[probe], remainingBudgetMs);

  try {
    const value = await withTimeout(
      () => execute(run.controller.signal),
      timeoutMs,
      `${probe} timed out after ${timeoutMs}ms`,
    );
    if (!isCurrentRun(run.token)) {
      return {
        record: makeRecord(probe, "Skipped", null, "Superseded by a newer health check run", Date.now()),
        lifecycle: "CANCELLED",
      };
    }
    const normalized = normalize(value);
    const endedAt = new Date().toISOString();
    setProbeLifecycle(
      probe,
      normalized.lifecycle,
      {
        outcome: normalized.record.outcome,
        endedAt,
        durationMs: normalized.record.durationMs,
      },
      normalized.record.reason,
    );
    updateLiveProbes({
      ...(getHealthCheckStateSnapshot().liveProbes ?? {}),
      [probe]: normalized.record,
    });
    return normalized;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error ?? `${probe} failed`);
    const timeout = isTimeoutLike(error);
    const cancelled = isAbortLike(error) || !isCurrentRun(run.token);
    const record = makeRecord(probe, timeout ? "Fail" : "Skipped", timeout ? timeoutMs : null, reason, Date.now());
    const lifecycle: ProbeExecution["lifecycle"] = timeout ? "TIMEOUT" : cancelled ? "CANCELLED" : "FAILED";
    const endedAt = new Date().toISOString();
    setProbeLifecycle(
      probe,
      lifecycle,
      {
        outcome: record.outcome,
        endedAt,
        durationMs: record.durationMs,
      },
      reason,
    );
    updateLiveProbes({
      ...(getHealthCheckStateSnapshot().liveProbes ?? {}),
      [probe]: record,
    });
    return { record, lifecycle };
  }
};

const setSkippedProbe = (probe: HealthCheckProbeType, reason: string): ProbeExecution => {
  const record = makeRecord(probe, "Skipped", null, reason, Date.now());
  const endedAt = new Date().toISOString();
  setProbeLifecycle(
    probe,
    "CANCELLED",
    {
      startedAt: getHealthCheckStateSnapshot().probeStates[probe].startedAt ?? endedAt,
      endedAt,
      durationMs: null,
      outcome: record.outcome,
    },
    reason,
  );
  updateLiveProbes({
    ...(getHealthCheckStateSnapshot().liveProbes ?? {}),
    [probe]: record,
  });
  return { record, lifecycle: "CANCELLED" };
};

const buildLocalProbeStates = () => resetHealthCheckProbeStates();

const cloneProbeStates = (probeStates: Record<HealthCheckProbeType, HealthCheckProbeExecutionState>) => ({
  REST: { ...probeStates.REST },
  FTP: { ...probeStates.FTP },
  TELNET: { ...probeStates.TELNET },
  CONFIG: { ...probeStates.CONFIG },
  RASTER: { ...probeStates.RASTER },
  JIFFY: { ...probeStates.JIFFY },
});

const computeProbeLatencyPercentiles = (
  records: Record<HealthCheckProbeType, HealthCheckProbeRecord>,
): { p50: number; p90: number; p99: number } => {
  const durations = Object.values(records)
    .map((record) => record.durationMs)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (durations.length === 0) {
    return { p50: 0, p90: 0, p99: 0 };
  }

  const percentile = (ratio: number) =>
    durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * ratio))];

  return {
    p50: percentile(0.5),
    p90: percentile(0.9),
    p99: percentile(0.99),
  };
};

const buildRunResult = (args: {
  runId: string;
  startTimestamp: string;
  endTimestamp: string;
  totalDurationMs: number;
  rest: ProbeExecution;
  ftp: ProbeExecution;
  telnet: ProbeExecution;
  config: ProbeExecution;
  raster: ProbeExecution;
  jiffy: ProbeExecution;
  deviceInfo?: HealthCheckRunResult["deviceInfo"];
  uptimeSeconds?: number | null;
  connectivity?: ConnectivityState;
  latency?: { p50: number; p90: number; p99: number };
}): HealthCheckRunResult => {
  const contributors = {
    App: {
      state:
        args.jiffy.lifecycle === "FAILED" ||
          args.config.lifecycle === "FAILED" ||
          args.telnet.lifecycle === "FAILED" ||
          args.jiffy.lifecycle === "TIMEOUT" ||
          args.config.lifecycle === "TIMEOUT" ||
          args.telnet.lifecycle === "TIMEOUT"
          ? ("Degraded" as const)
          : args.jiffy.lifecycle === "CANCELLED" &&
            args.config.lifecycle === "CANCELLED" &&
            args.telnet.lifecycle === "CANCELLED"
            ? ("Idle" as const)
            : ("Healthy" as const),
      problemCount: 0,
      totalOperations: 0,
      failedOperations: 0,
    },
    REST: {
      state:
        args.rest.lifecycle === "FAILED" || args.rest.lifecycle === "TIMEOUT"
          ? ("Unhealthy" as const)
          : args.rest.lifecycle === "SUCCESS"
            ? ("Healthy" as const)
            : ("Idle" as const),
      problemCount: 0,
      totalOperations: 0,
      failedOperations: 0,
    },
    FTP: {
      state:
        args.ftp.lifecycle === "FAILED" || args.ftp.lifecycle === "TIMEOUT"
          ? ("Unhealthy" as const)
          : args.ftp.lifecycle === "SUCCESS"
            ? ("Healthy" as const)
            : ("Idle" as const),
      problemCount: 0,
      totalOperations: 0,
      failedOperations: 0,
    },
  };

  const connectivity = args.connectivity ?? deriveConnectivityState(getConnectionSnapshot().state);
  const overallHealth = rollUpHealth(contributors, connectivity);
  const latency = args.latency ?? computeLatencyPercentiles();
  const probes = {
    REST: args.rest.record,
    FTP: args.ftp.record,
    TELNET: args.telnet.record,
    CONFIG: args.config.record,
    RASTER: args.raster.record,
    JIFFY: args.jiffy.record,
  };

  return {
    runId: args.runId,
    startTimestamp: args.startTimestamp,
    endTimestamp: args.endTimestamp,
    totalDurationMs: args.totalDurationMs,
    overallHealth,
    connectivity,
    probes,
    latency: { p50: latency.p50, p90: latency.p90, p99: latency.p99 },
    deviceInfo: args.deviceInfo ? { ...args.deviceInfo, uptimeSeconds: args.uptimeSeconds ?? null } : undefined,
  };
};

export const runHealthCheckForTarget = async (
  target: HealthCheckTarget,
  options: {
    signal?: AbortSignal;
    mode?: HealthCheckTargetRunMode;
    onProgress?: (snapshot: HealthCheckProgressSnapshot) => void;
  } = {},
): Promise<HealthCheckRunResult> => {
  const runId = generateRunId();
  const startTimestamp = new Date().toISOString();
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + GLOBAL_RUN_TIMEOUT_MS;
  const mode = options.mode ?? "full";
  const runtime = buildProbeRuntime(target);
  const controller = new AbortController();
  const probeStates = buildLocalProbeStates();
  const liveProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> = {};
  const outerSignal = options.signal;
  const abortFromOuter = () => controller.abort(outerSignal?.reason);

  if (outerSignal) {
    if (outerSignal.aborted) {
      controller.abort(outerSignal.reason);
    } else {
      outerSignal.addEventListener("abort", abortFromOuter, { once: true });
    }
  }

  const emitProgress = () => {
    options.onProgress?.({
      liveProbes: { ...liveProbes },
      probeStates: cloneProbeStates(probeStates),
    });
  };

  const setLocalProbeLifecycle = (
    probe: HealthCheckProbeType,
    nextState: HealthCheckProbeLifecycle,
    updates: Partial<HealthCheckProbeExecutionState>,
    reason: string | null,
  ) => {
    probeStates[probe] = {
      ...probeStates[probe],
      ...updates,
      state: nextState,
      reason,
    };
  };

  const setLocalSkippedProbe = (probe: HealthCheckProbeType, reason: string): ProbeExecution => {
    const endedAt = new Date().toISOString();
    const record = makeRecord(probe, "Skipped", null, reason, Date.now());
    setLocalProbeLifecycle(
      probe,
      "CANCELLED",
      {
        startedAt: probeStates[probe].startedAt ?? endedAt,
        endedAt,
        durationMs: null,
        outcome: record.outcome,
      },
      reason,
    );
    liveProbes[probe] = record;
    emitProgress();
    return { record, lifecycle: "CANCELLED" };
  };

  const runLocalProbe = async <T>(
    probe: HealthCheckProbeType,
    execute: (signal: AbortSignal) => Promise<T>,
    normalize: (value: T) => ProbeExecution,
  ): Promise<ProbeExecution> => {
    const startedAt = new Date().toISOString();
    setLocalProbeLifecycle(
      probe,
      "RUNNING",
      {
        startedAt,
        endedAt: null,
        durationMs: null,
        outcome: null,
      },
      null,
    );
    emitProgress();

    const remainingBudgetMs = Math.max(1, deadlineMs - Date.now());
    const timeoutMs = Math.min(PROBE_TIMEOUT_MS[probe], remainingBudgetMs);

    try {
      const value = await withTimeout(
        () => execute(controller.signal),
        timeoutMs,
        `${probe} timed out after ${timeoutMs}ms`,
      );
      const normalized = normalize(value);
      liveProbes[probe] = normalized.record;
      setLocalProbeLifecycle(
        probe,
        normalized.lifecycle,
        {
          outcome: normalized.record.outcome,
          endedAt: new Date().toISOString(),
          durationMs: normalized.record.durationMs,
        },
        normalized.record.reason,
      );
      emitProgress();
      return normalized;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error ?? `${probe} failed`);
      const timeout = isTimeoutLike(error);
      const cancelled = isAbortLike(error) || controller.signal.aborted;
      const record = makeRecord(probe, timeout ? "Fail" : "Skipped", timeout ? timeoutMs : null, reason, Date.now());
      const lifecycle: ProbeExecution["lifecycle"] = timeout ? "TIMEOUT" : cancelled ? "CANCELLED" : "FAILED";
      liveProbes[probe] = record;
      setLocalProbeLifecycle(
        probe,
        lifecycle,
        {
          outcome: record.outcome,
          endedAt: new Date().toISOString(),
          durationMs: record.durationMs,
        },
        reason,
      );
      emitProgress();
      if (cancelled) {
        throw error;
      }
      return { record, lifecycle };
    }
  };

  try {
    const rest = await runLocalProbe(
      "REST",
      (signal) => probeRest(signal, runtime),
      ({ record, deviceInfo }) => ({
        record,
        lifecycle: lifecycleFromRecord(record.outcome),
        deviceInfo,
      }),
    );
    const restFailed = rest.lifecycle === "FAILED" || rest.lifecycle === "TIMEOUT";

    const ftp = restFailed
      ? setLocalSkippedProbe("FTP", "Skipped: REST probe failed")
      : await runLocalProbe(
        "FTP",
        async () => probeFtp(runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );

    const telnet = restFailed
      ? setLocalSkippedProbe("TELNET", "Skipped: REST probe failed")
      : await runLocalProbe(
        "TELNET",
        (signal) => probeTelnet(signal, runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );

    const config = restFailed
      ? setLocalSkippedProbe("CONFIG", "Skipped: REST probe failed")
      : mode === "passive"
        ? setLocalSkippedProbe("CONFIG", "Skipped: passive mode disables CONFIG pulse")
        : await runLocalProbe(
          "CONFIG",
          (signal) => probeConfig(signal, runtime),
          (record) => ({
            record,
            lifecycle: lifecycleFromRecord(record.outcome),
          }),
        );

    const raster = restFailed
      ? setLocalSkippedProbe("RASTER", "Skipped: REST probe failed")
      : await runLocalProbe(
        "RASTER",
        (signal) => probeRaster(signal, runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );

    const jiffy = restFailed
      ? setLocalSkippedProbe("JIFFY", "Skipped: REST probe failed")
      : await runLocalProbe(
        "JIFFY",
        (signal) => probeJiffy(signal, runtime),
        ({ record, uptimeSeconds }) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
          uptimeSeconds,
        }),
      );

    const endTimestamp = new Date().toISOString();
    const result = buildRunResult({
      runId,
      startTimestamp,
      endTimestamp,
      totalDurationMs: Date.now() - startedAtMs,
      rest,
      ftp,
      telnet,
      config,
      raster,
      jiffy,
      deviceInfo: rest.deviceInfo,
      uptimeSeconds: jiffy.uptimeSeconds,
      connectivity: rest.lifecycle === "SUCCESS" ? "Online" : "Offline",
      latency: computeProbeLatencyPercentiles({
        REST: rest.record,
        FTP: ftp.record,
        TELNET: telnet.record,
        CONFIG: config.record,
        RASTER: raster.record,
        JIFFY: jiffy.record,
      }),
    });

    return result;
  } finally {
    if (outerSignal) {
      outerSignal.removeEventListener("abort", abortFromOuter);
    }
  }
};

const recordHealthHistory = (result: HealthCheckRunResult) => {
  pushHealthHistoryEntry({
    timestamp: result.startTimestamp,
    overallHealth: result.overallHealth,
    durationMs: result.totalDurationMs,
    probes: {
      rest: {
        outcome: result.probes.REST.outcome,
        durationMs: result.probes.REST.durationMs,
        reason: result.probes.REST.reason,
      },
      jiffy: {
        outcome: result.probes.JIFFY.outcome,
        durationMs: result.probes.JIFFY.durationMs,
        reason: result.probes.JIFFY.reason,
      },
      raster: {
        outcome: result.probes.RASTER.outcome,
        durationMs: result.probes.RASTER.durationMs,
        reason: result.probes.RASTER.reason,
      },
      config: {
        outcome: result.probes.CONFIG.outcome,
        durationMs: result.probes.CONFIG.durationMs,
        reason: result.probes.CONFIG.reason,
      },
      ftp: {
        outcome: result.probes.FTP.outcome,
        durationMs: result.probes.FTP.durationMs,
        reason: result.probes.FTP.reason,
      },
      telnet: {
        outcome: result.probes.TELNET.outcome,
        durationMs: result.probes.TELNET.durationMs,
        reason: result.probes.TELNET.reason,
      },
    },
    latency: result.latency,
  });
};

export const recoverStaleHealthCheckRun = (reason = "Health check run exceeded its allowed lifetime"): boolean => {
  const snapshot = getHealthCheckStateSnapshot();
  if (snapshot.runState !== "RUNNING" || snapshot.staleAfterMs === null || Date.now() <= snapshot.staleAfterMs) {
    return false;
  }
  return cancelActiveRun("TIMEOUT", reason);
};

export const cancelHealthCheck = (reason = "Cancelled by user"): boolean => cancelActiveRun("CANCELLED", reason);

export const runHealthCheck = async (
  onProbeProgress?: (partial: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>>) => void,
): Promise<HealthCheckRunResult | null> => {
  if (activeRun) {
    cancelActiveRun("CANCELLED", "Superseded by a new health check run");
  }

  const token = Symbol("health-check-run");
  const runId = generateRunId();
  const startTimestamp = new Date().toISOString();
  const startedAtMs = Date.now();
  const run: ActiveRun = {
    token,
    runId,
    controller: new AbortController(),
    startedAtMs,
    deadlineMs: startedAtMs + GLOBAL_RUN_TIMEOUT_MS,
  };
  activeRun = run;

  setHealthCheckStateSnapshot({
    running: true,
    runState: "RUNNING",
    currentRunId: runId,
    startedAt: startTimestamp,
    endedAt: null,
    staleAfterMs: run.deadlineMs + STALE_RUN_GRACE_MS,
    lastTransitionReason: null,
    liveProbes: {},
    probeStates: buildProbeStates(),
  });
  appendHealthCheckTransition({
    timestamp: startTimestamp,
    scope: "run",
    target: runId,
    from: getHealthCheckStateSnapshot().runState === "RUNNING" ? "IDLE" : getHealthCheckStateSnapshot().runState,
    to: "RUNNING",
    reason: null,
  });

  const publishProgress = (partial: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>>) => {
    onProbeProgress?.(partial);
    updateLiveProbes(partial);
  };

  try {
    addLog("info", "Health check started", { runId });
    const runtime = buildProbeRuntime();

    const rest = await runProbe(
      run,
      "REST",
      (signal) => probeRest(signal, runtime),
      ({ record, deviceInfo }) => ({
        record,
        lifecycle: lifecycleFromRecord(record.outcome),
        deviceInfo,
      }),
    );
    publishProgress({ ...(getHealthCheckStateSnapshot().liveProbes ?? {}), REST: rest.record });

    const restFailed = rest.lifecycle === "FAILED" || rest.lifecycle === "TIMEOUT";

    const ftp = restFailed
      ? setSkippedProbe("FTP", "Skipped: REST probe failed")
      : await runProbe(
        run,
        "FTP",
        async () => probeFtp(runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );
    publishProgress({ ...(getHealthCheckStateSnapshot().liveProbes ?? {}), FTP: ftp.record });

    const telnet = restFailed
      ? setSkippedProbe("TELNET", "Skipped: REST probe failed")
      : await runProbe(
        run,
        "TELNET",
        (signal) => probeTelnet(signal, runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );
    publishProgress({ ...(getHealthCheckStateSnapshot().liveProbes ?? {}), TELNET: telnet.record });

    const config = restFailed
      ? setSkippedProbe("CONFIG", "Skipped: REST probe failed")
      : await runProbe(
        run,
        "CONFIG",
        (signal) => probeConfig(signal, runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );
    publishProgress({ ...(getHealthCheckStateSnapshot().liveProbes ?? {}), CONFIG: config.record });

    const raster = restFailed
      ? setSkippedProbe("RASTER", "Skipped: REST probe failed")
      : await runProbe(
        run,
        "RASTER",
        (signal) => probeRaster(signal, runtime),
        (record) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
        }),
      );
    publishProgress({ ...(getHealthCheckStateSnapshot().liveProbes ?? {}), RASTER: raster.record });

    const jiffy = restFailed
      ? setSkippedProbe("JIFFY", "Skipped: REST probe failed")
      : await runProbe(
        run,
        "JIFFY",
        (signal) => probeJiffy(signal, runtime),
        ({ record, uptimeSeconds }) => ({
          record,
          lifecycle: lifecycleFromRecord(record.outcome),
          uptimeSeconds,
        }),
      );
    publishProgress({ ...(getHealthCheckStateSnapshot().liveProbes ?? {}), JIFFY: jiffy.record });

    if (!isCurrentRun(token)) {
      return null;
    }

    const endTimestamp = new Date().toISOString();
    const totalDurationMs = Date.now() - startedAtMs;
    const result = buildRunResult({
      runId,
      startTimestamp,
      endTimestamp,
      totalDurationMs,
      rest,
      ftp,
      telnet,
      config,
      raster,
      jiffy,
      deviceInfo: rest.deviceInfo,
      uptimeSeconds: jiffy.uptimeSeconds,
    });

    recordHealthHistory(result);

    const terminalRunState: HealthCheckRunLifecycle = [rest, ftp, telnet, config, raster, jiffy].some(
      (probe) => probe.lifecycle === "TIMEOUT",
    )
      ? "TIMEOUT"
      : [rest, ftp, telnet, config, raster, jiffy].some((probe) => probe.lifecycle === "FAILED")
        ? "FAILED"
        : "COMPLETED";

    addLog("info", "Health check completed", {
      runId,
      overallHealth: result.overallHealth,
      durationMs: totalDurationMs,
      outcomes: Object.fromEntries(Object.entries(result.probes).map(([key, value]) => [key, value.outcome])),
      runState: terminalRunState,
    });

    activeRun = null;
    setRunLifecycle(terminalRunState, terminalRunState === "TIMEOUT" ? "Health check timed out" : null, {
      currentRunId: runId,
      endedAt: endTimestamp,
      staleAfterMs: null,
      latestResult: result,
      liveProbes: null,
    });

    return result;
  } catch (error) {
    if (!isCurrentRun(token)) {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error ?? "Health check failed");
    activeRun = null;
    setRunLifecycle(isTimeoutLike(error) ? "TIMEOUT" : isAbortLike(error) ? "CANCELLED" : "FAILED", message, {
      currentRunId: runId,
      endedAt: new Date().toISOString(),
      staleAfterMs: null,
      liveProbes: null,
    });
    addLog("error", "Health check run failed unexpectedly", {
      runId,
      error: message,
      stack: error instanceof Error ? error.stack : null,
    });
    throw error;
  }
};

export const isHealthCheckRunning = (): boolean =>
  activeRun !== null && getHealthCheckStateSnapshot().runState === "RUNNING";
