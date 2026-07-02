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
  telnetConnectCooldownMs: 150,
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
const getActiveAutoResolutionContext = vi.fn(() => ({ activeProduct: null, activeDeviceId: null }));
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
  getActiveAutoResolutionContext,
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

  it("allows a single user REST half-open probe while circuit override is disabled", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const systemMeta = {
      action: makeAction("rest-circuit-background-noise"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "background" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
      bypassCache: true,
    };

    const failingHandler = vi.fn().mockRejectedValue(new Error("Network error"));
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");

    await expect(
      withRestInteraction({ ...systemMeta, intent: "system" as const }, vi.fn().mockResolvedValue({ ok: true })),
    ).rejects.toThrow("Device circuit open");

    const userMeta = {
      ...systemMeta,
      action: makeAction("rest-circuit-user-half-open"),
      intent: "user" as const,
    };
    const userProbeHandler = vi.fn().mockResolvedValue({ ok: true });
    await expect(withRestInteraction(userMeta, userProbeHandler)).resolves.toEqual({ ok: true });
    expect(userProbeHandler).toHaveBeenCalledTimes(1);
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      userMeta.action,
      expect.objectContaining({ decision: "override", reason: "circuit-open" }),
    );
  });

  it("queues a second user REST request behind an in-flight half-open probe", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const systemMeta = {
      action: makeAction("rest-circuit-background-noise"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "background" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
      bypassCache: true,
    };

    const failingHandler = vi.fn().mockRejectedValue(new Error("Network error"));
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");

    const userMeta = {
      ...systemMeta,
      action: makeAction("rest-circuit-user-half-open"),
      intent: "user" as const,
    };
    let resolveFirst: ((value: { ok: boolean }) => void) | null = null;
    const firstHandler = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const firstProbe = withRestInteraction(userMeta, firstHandler);
    await vi.waitFor(() => expect(firstHandler).toHaveBeenCalledTimes(1));

    const secondHandler = vi.fn().mockResolvedValue({ ok: true });
    const secondProbe = withRestInteraction(
      {
        ...userMeta,
        action: makeAction("rest-circuit-user-half-open-second"),
      },
      secondHandler,
    );
    expect(secondHandler).not.toHaveBeenCalled();

    resolveFirst?.({ ok: true });
    await expect(firstProbe).resolves.toEqual({ ok: true });
    await expect(secondProbe).resolves.toEqual({ ok: true });
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it("rejects a queued user REST request with circuit-open when the half-open probe fails", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const systemMeta = {
      action: makeAction("rest-circuit-background-noise"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "background" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
      bypassCache: true,
    };

    const failingHandler = vi.fn().mockRejectedValue(new Error("Network error"));
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");

    const userMeta = {
      ...systemMeta,
      action: makeAction("rest-circuit-user-half-open"),
      intent: "user" as const,
    };
    let rejectFirst: ((reason: Error) => void) | null = null;
    const firstHandler = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    const firstProbe = withRestInteraction(userMeta, firstHandler);
    void firstProbe.catch(() => undefined);
    await vi.waitFor(() => expect(firstHandler).toHaveBeenCalledTimes(1));

    const secondHandler = vi.fn().mockResolvedValue({ ok: true });
    const secondProbe = withRestInteraction(
      {
        ...userMeta,
        action: makeAction("rest-circuit-user-half-open-second"),
      },
      secondHandler,
    );
    void secondProbe.catch(() => undefined);

    rejectFirst?.(new Error("Network error"));
    await expect(firstProbe).rejects.toThrow("Network error");
    await expect(secondProbe).rejects.toThrow("Device circuit open");
    expect(secondHandler).not.toHaveBeenCalled();
  });

  it("counts structured REST timeouts less aggressively than hard network failures", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("rest-structured-timeout"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
    };
    const timeoutError = () =>
      Object.assign(new Error("Host unreachable"), {
        c64uRestFailureKind: "timeout",
      });
    const timeoutHandler = vi.fn(() => Promise.reject(timeoutError()));

    await expect(withRestInteraction(meta, timeoutHandler)).rejects.toThrow("Host unreachable");
    await expect(withRestInteraction(meta, timeoutHandler)).rejects.toThrow("Host unreachable");
    await expect(withRestInteraction(meta, timeoutHandler)).rejects.toThrow("Host unreachable");
    await expect(withRestInteraction(meta, timeoutHandler)).rejects.toThrow("Host unreachable");
    await expect(withRestInteraction(meta, vi.fn().mockResolvedValue({ ok: true }))).rejects.toThrow(
      "Device circuit open",
    );
    expect(timeoutHandler).toHaveBeenCalledTimes(4);
  });

  it("allows diagnostic REST probes to bypass an open circuit and reset it on success", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("rest-circuit-health"),
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
    };

    const failingHandler = vi.fn().mockRejectedValue(new Error("Network error"));
    const first = withRestInteraction(meta, failingHandler);
    void first.catch(() => undefined);
    await vi.runOnlyPendingTimersAsync();
    await expect(first).rejects.toThrow("Network error");

    const second = withRestInteraction(meta, failingHandler);
    void second.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(300);
    await expect(second).rejects.toThrow("Network error");

    const bypassHandler = vi.fn().mockResolvedValue({ product: "C64 Ultimate" });
    const bypass = withRestInteraction({ ...meta, bypassCircuit: true }, bypassHandler);
    await vi.advanceTimersByTimeAsync(300);
    await expect(bypass).resolves.toEqual({ product: "C64 Ultimate" });

    expect(bypassHandler).toHaveBeenCalledTimes(1);
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      meta.action,
      expect.objectContaining({ decision: "override", reason: "circuit-open" }),
    );
    expect(setCircuitOpenUntil).toHaveBeenCalledWith(null);
  });
});
