/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceSafetyConfig } from "@/lib/config/deviceSafetySettings";
import type { DeviceState } from "@/lib/deviceInteraction/deviceStateStore";
import type { TraceActionContext } from "@/lib/tracing/types";

const createConfig = (): DeviceSafetyConfig => ({
  mode: "BALANCED",
  ftpMaxConcurrency: 1,
  infoCacheMs: 300,
  configsCacheMs: 0,
  configsCooldownMs: 0,
  drivesCooldownMs: 0,
  ftpListCooldownMs: 150,
  backoffBaseMs: 100,
  backoffMaxMs: 400,
  backoffFactor: 2,
  circuitBreakerThreshold: 2,
  circuitBreakerCooldownMs: 500,
  discoveryProbeIntervalMs: 400,
  allowUserOverrideCircuit: false,
});

let config: DeviceSafetyConfig = createConfig();
let deviceStateValue: DeviceState = "READY";

const loadDeviceSafetyConfig = vi.fn(() => config);
const subscribeDeviceSafetyUpdates = vi.fn(() => () => undefined);
const getDeviceStateSnapshot = vi.fn(() => ({
  state: deviceStateValue,
  connectionState: "REAL_CONNECTED",
  busyCount: 0,
  lastRequestAtMs: null,
  lastUpdatedAtMs: Date.now(),
  lastErrorMessage: null,
  lastSuccessAtMs: null,
  circuitOpenUntilMs: null,
}));
const markDeviceRequestStart = vi.fn();
const markDeviceRequestEnd = vi.fn();
const setCircuitOpenUntil = vi.fn();
const recordDeviceGuard = vi.fn();
const addLog = vi.fn();
const addErrorLog = vi.fn();

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig,
  subscribeDeviceSafetyUpdates,
}));

vi.mock("@/lib/deviceInteraction/deviceStateStore", () => ({
  getDeviceStateSnapshot,
  markDeviceRequestStart,
  markDeviceRequestEnd,
  setCircuitOpenUntil,
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  recordDeviceGuard,
}));

vi.mock("@/lib/logging", () => ({
  addLog,
  addErrorLog,
}));

const makeAction = (name = "test-action"): TraceActionContext => ({
  correlationId: "trace-1",
  origin: "system",
  name,
  componentName: null,
});

const applyNonTestEnv = () => {
  const previousVitest = process.env.VITEST;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.VITEST = "false";
  process.env.NODE_ENV = "production";
  return () => {
    process.env.VITEST = previousVitest;
    process.env.NODE_ENV = previousNodeEnv;
  };
};

describe("deviceInteractionManager circuit cooldown", () => {
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    restoreEnv = applyNonTestEnv();
    config = createConfig();
    deviceStateValue = "READY";
    recordDeviceGuard.mockClear();
    addErrorLog.mockClear();
    addLog.mockClear();
    markDeviceRequestStart.mockClear();
    markDeviceRequestEnd.mockClear();
    setCircuitOpenUntil.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    restoreEnv?.();
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    vi.useRealTimers();
  });

  it("opens the REST circuit after consecutive failures, blocks new requests, and recovers after cooldown", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("rest-circuit"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
    };

    const failingHandler = vi.fn().mockRejectedValue(new Error("Network error"));
    await expect(withRestInteraction(meta, failingHandler)).rejects.toThrow("Network error");
    await expect(withRestInteraction(meta, failingHandler)).rejects.toThrow("Network error");

    const blockedHandler = vi.fn().mockResolvedValue({ ok: true });
    await expect(withRestInteraction(meta, blockedHandler)).rejects.toThrow("Device circuit open");
    expect(blockedHandler).not.toHaveBeenCalled();
    expect(setCircuitOpenUntil).toHaveBeenCalledWith(expect.any(Number), "Network error");

    await vi.advanceTimersByTimeAsync(500);

    const recoveredHandler = vi.fn().mockResolvedValue({ ok: true });
    await expect(withRestInteraction(meta, recoveredHandler)).resolves.toEqual({ ok: true });
    expect(recoveredHandler).toHaveBeenCalledTimes(1);
    expect(setCircuitOpenUntil).toHaveBeenCalledWith(null);
  });
});
