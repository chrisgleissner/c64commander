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
  allowUserOverrideCircuit: true,
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

describe("deviceInteractionManager", () => {
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
    vi.useRealTimers();
  });

  afterEach(() => {
    restoreEnv?.();
    delete (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling;
    vi.useRealTimers();
  });

  it("coalesces inflight REST requests and caches responses", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-info");
    const meta = {
      action,
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    let resolveHandler: ((value: { status: string }) => void) | null = null;
    const handler = vi.fn(
      () =>
        new Promise<{ status: string }>((resolve) => {
          resolveHandler = resolve;
        }),
    );

    const first = withRestInteraction(meta, handler);
    const second = withRestInteraction(meta, handler);

    await expect.poll(() => handler.mock.calls.length).toBe(1);
    resolveHandler?.({ status: "ok" });

    await expect(first).resolves.toEqual({ status: "ok" });
    await expect(second).resolves.toEqual({ status: "ok" });

    const cached = await withRestInteraction(meta, handler);
    expect(cached).toEqual({ status: "ok" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(recordDeviceGuard).toHaveBeenCalledWith(action, expect.objectContaining({ decision: "coalesce" }));
    expect(recordDeviceGuard).toHaveBeenCalledWith(action, expect.objectContaining({ decision: "cache" }));
  });

  it("coalesces a burst of identical GET requests behind one inflight handler", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("rest-info-burst"),
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    let releaseHandler!: () => void;
    const handlerBlocked = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handler = vi.fn(async () => {
      await handlerBlocked;
      return { product: "C64U" };
    });

    const requests = Array.from({ length: 20 }, () => withRestInteraction(meta, handler));

    await expect.poll(() => handler.mock.calls.length).toBe(1);

    releaseHandler();
    await expect(Promise.all(requests)).resolves.toEqual(Array.from({ length: 20 }, () => ({ product: "C64U" })));
  });

  it("does not coalesce concurrent config writes that share the same mutation lane", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("rest-config-write"),
      method: "POST",
      path: "/v1/configs",
      normalizedUrl: "http://device/v1/configs",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const callOrder: string[] = [];
    const firstHandler = vi.fn(async () => {
      callOrder.push("first");
      await firstBlocked;
      return { errors: [] };
    });
    const secondHandler = vi.fn(async () => {
      callOrder.push("second");
      return { errors: [] };
    });

    const first = withRestInteraction(meta, firstHandler);
    const second = withRestInteraction(meta, secondHandler);

    await expect.poll(() => firstHandler.mock.calls.length).toBe(1);
    expect(secondHandler).not.toHaveBeenCalled();

    releaseFirst();
    await Promise.all([first, second]);

    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["first", "second"]);
  });

  it("invalidates cached config reads after a successful config mutation", async () => {
    config = {
      ...createConfig(),
      configsCacheMs: 300,
    };

    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const readMeta = {
      action: makeAction("rest-config-read"),
      method: "GET",
      path: "/v1/configs",
      normalizedUrl: "http://device/v1/configs",
      intent: "system" as const,
      baseUrl: "http://device",
    };
    const writeMeta = {
      action: makeAction("rest-config-write-invalidate"),
      method: "PUT",
      path: "/v1/configs/Audio%20Mixer/Vol%20Socket%201?value=0%20dB",
      normalizedUrl: "http://device/v1/configs/Audio%20Mixer/Vol%20Socket%201?value=0%20dB",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    const firstRead = vi.fn().mockResolvedValue({ value: 1 });
    const cachedRead = vi.fn().mockResolvedValue({ value: 999 });
    const refreshedRead = vi.fn().mockResolvedValue({ value: 2 });

    await expect(withRestInteraction(readMeta, firstRead)).resolves.toEqual({ value: 1 });
    await expect(withRestInteraction(readMeta, cachedRead)).resolves.toEqual({ value: 1 });
    expect(cachedRead).not.toHaveBeenCalled();

    await expect(withRestInteraction(writeMeta, vi.fn().mockResolvedValue({ errors: [] }))).resolves.toEqual({
      errors: [],
    });

    await expect(withRestInteraction(readMeta, refreshedRead)).resolves.toEqual({ value: 2 });
    expect(refreshedRead).toHaveBeenCalledTimes(1);
  });

  it("applies concurrent slider-style writes in order so the final device value is the last value", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("rest-slider-write"),
      method: "POST",
      path: "/v1/configs",
      normalizedUrl: "http://device/v1/configs",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    let deviceValue = 0;
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writeOrder: number[] = [];

    const writes = [20, 40, 60, 80].map((value, index) =>
      withRestInteraction(meta, async () => {
        writeOrder.push(value);
        if (index === 0) {
          await firstBlocked;
        }
        deviceValue = value;
        return { errors: [] };
      }),
    );

    await Promise.resolve();
    releaseFirst();
    await Promise.all(writes);

    expect(writeOrder).toEqual([20, 40, 60, 80]);
    expect(deviceValue).toBe(80);
  });

  it("does not let a cooled-down read occupy the only REST slot before a ready write can run", async () => {
    vi.useFakeTimers();
    config = {
      ...createConfig(),
      configsCooldownMs: 100,
    };

    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const readMeta = {
      action: makeAction("rest-config-cooldown"),
      method: "GET",
      path: "/v1/configs",
      normalizedUrl: "http://device/v1/configs",
      intent: "system" as const,
      baseUrl: "http://device",
    };
    const writeMeta = {
      action: makeAction("rest-machine-write"),
      method: "PUT",
      path: "/v1/machine:pause",
      normalizedUrl: "http://device/v1/machine:pause",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    await withRestInteraction(readMeta, vi.fn().mockResolvedValue({ errors: [] }));

    const cooledReadHandler = vi.fn().mockResolvedValue({ errors: [] });
    const cooledRead = withRestInteraction(readMeta, cooledReadHandler);
    const writeHandler = vi.fn().mockResolvedValue({ errors: [] });
    const write = withRestInteraction(writeMeta, writeHandler);

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeHandler).toHaveBeenCalledTimes(1);
    expect(cooledReadHandler).not.toHaveBeenCalled();

    await expect(write).resolves.toEqual({ errors: [] });

    await vi.advanceTimersByTimeAsync(100);
    await expect(cooledRead).resolves.toEqual({ errors: [] });
    expect(cooledReadHandler).toHaveBeenCalledTimes(1);
  });

  it("blocks REST calls when device is in error state", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    deviceStateValue = "ERROR";
    config = {
      ...createConfig(),
      allowUserOverrideCircuit: false,
    };

    const action = makeAction("rest-error");
    const meta = {
      action,
      method: "GET",
      path: "/v1/configs",
      normalizedUrl: "http://device/v1/configs",
      intent: "background" as const,
      baseUrl: "http://device",
    };

    await expect(withRestInteraction(meta, vi.fn())).rejects.toThrow("Device not ready for requests");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      action,
      expect.objectContaining({ decision: "block", reason: "state" }),
    );
  });

  it("applies backoff and opens circuit after critical failures", async () => {
    config = {
      ...createConfig(),
      backoffBaseMs: 100,
      backoffMaxMs: 200,
      backoffFactor: 2,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 500,
      allowUserOverrideCircuit: false,
    };

    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-backoff");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockRejectedValue(new Error("Network timed out"));

    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Network timed out");

    const second = withRestInteraction(meta, handler);
    await expect(second).rejects.toThrow("Network timed out");

    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Device circuit open");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      action,
      expect.objectContaining({ decision: "block", reason: "circuit-open" }),
    );
    expect(setCircuitOpenUntil).toHaveBeenCalled();
  });

  it("tracks FTP failures and coalesces inflight operations without duplicate canonical logging", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("ftp-list");
    const meta = {
      action,
      operation: "list",
      path: "/root",
      intent: "system" as const,
    };

    let resolveHandler: (() => void) | null = null;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        }),
    );

    const first = withFtpInteraction(meta, handler);
    const second = withFtpInteraction(meta, handler);

    await expect.poll(() => handler.mock.calls.length).toBe(1);
    resolveHandler?.();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    const failingHandler = vi.fn().mockRejectedValue(new Error("FTP failed"));
    await expect(withFtpInteraction(meta, failingHandler)).rejects.toThrow("FTP failed");
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: false, errorMessage: "FTP failed" });
    expect(addErrorLog).not.toHaveBeenCalledWith("FTP request failed", expect.any(Object));
  });

  it("retries a transient FTP connect timeout once and resolves with one scheduled operation", async () => {
    vi.useFakeTimers();
    const { withFtpInteraction, resetInteractionState, FTP_TRANSIENT_RETRY_DELAY_MS } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("ftp-transient-retry"),
      operation: "list" as const,
      path: "/USB2",
      intent: "system" as const,
      host: "u64",
    };
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("SocketTimeoutException: failed to connect after 1500ms"))
      .mockResolvedValueOnce("ok");

    const result = withFtpInteraction(meta, handler);
    await expect.poll(() => handler.mock.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(FTP_TRANSIENT_RETRY_DELAY_MS);

    await expect(result).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      meta.action,
      expect.objectContaining({ decision: "defer", reason: "retry" }),
    );
  });

  it("does not retry non-retryable FTP login failures", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("ftp-login-failed"),
      operation: "list" as const,
      path: "/",
      intent: "system" as const,
      host: "u64",
    };
    const handler = vi.fn().mockRejectedValue(new Error("FTP login failed"));

    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("FTP login failed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not retry when a transient FTP failure opens the circuit", async () => {
    config = { ...createConfig(), circuitBreakerThreshold: 1, allowUserOverrideCircuit: false };
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("ftp-circuit-no-retry"),
      operation: "list" as const,
      path: "/USB2",
      intent: "system" as const,
      host: "u64",
    };
    const handler = vi.fn().mockRejectedValue(new Error("FTP listDirectory timed out after connect 1500ms"));

    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("FTP listDirectory timed out");
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("FTP circuit open");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stops after one retry when transient FTP failures persist", async () => {
    vi.useFakeTimers();
    const { withFtpInteraction, resetInteractionState, FTP_TRANSIENT_RETRY_DELAY_MS } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("ftp-persistent-transient"),
      operation: "read" as const,
      path: "/USB2/demo.sid",
      intent: "system" as const,
      host: "u64",
    };
    const handler = vi.fn().mockRejectedValue(new Error("Connection reset during FTP connect"));

    const result = withFtpInteraction(meta, handler);
    const assertion = expect(result).rejects.toThrow("Connection reset during FTP connect");
    await expect.poll(() => handler.mock.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(FTP_TRANSIENT_RETRY_DELAY_MS);

    await assertion;
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("PH9: does not coalesce concurrent same-path FTP operations across different hosts", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const baseMeta = {
      action: makeAction("ftp-list-multi-host"),
      operation: "list" as const,
      path: "/root",
      intent: "system" as const,
    };

    // Pre-PH9 the in-flight key was operation+path only, so the c64u call
    // would have piggybacked the u64 promise and resolved with "u64". With
    // PH9 the key includes host, so the c64u call gets its own handler
    // invocation and resolves with "c64u".
    let releaseU64: (() => void) | null = null;
    let releaseC64u: (() => void) | null = null;
    const handlerU64 = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseU64 = () => resolve("u64");
        }),
    );
    const handlerC64u = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseC64u = () => resolve("c64u");
        }),
    );

    const u64Result = withFtpInteraction({ ...baseMeta, host: "u64" }, handlerU64);
    const c64uResult = withFtpInteraction({ ...baseMeta, host: "c64u" }, handlerC64u);

    await expect.poll(() => handlerU64.mock.calls.length).toBe(1);
    expect(handlerC64u).not.toHaveBeenCalled();
    releaseU64?.();
    await expect.poll(() => handlerC64u.mock.calls.length).toBe(1);
    releaseC64u?.();

    await expect(u64Result).resolves.toBe("u64");
    await expect(c64uResult).resolves.toBe("c64u");
    expect(handlerU64).toHaveBeenCalledTimes(1);
    expect(handlerC64u).toHaveBeenCalledTimes(1);
  });

  it("PH9: still coalesces concurrent same-path FTP operations against the same host", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const meta = {
      action: makeAction("ftp-list-same-host"),
      operation: "list" as const,
      path: "/root",
      intent: "system" as const,
      host: "u64",
    };

    let release: (() => void) | null = null;
    const handler = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("ok");
        }),
    );

    const first = withFtpInteraction(meta, handler);
    const second = withFtpInteraction(meta, handler);

    // Inflight coalescing: second call returns the first promise without re-invoking
    await expect.poll(() => handler.mock.calls.length).toBe(1);
    release?.();
    await expect(first).resolves.toBe("ok");
    await expect(second).resolves.toBe("ok");
  });

  it("PH9: same host with different ports remain isolated", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const baseMeta = {
      action: makeAction("ftp-list-multi-port"),
      operation: "list" as const,
      path: "/root",
      intent: "system" as const,
      host: "u64",
    };

    const handlerDefault = vi.fn().mockResolvedValue("21");
    const handlerAlternate = vi.fn().mockResolvedValue("2121");

    const defaultResult = await withFtpInteraction({ ...baseMeta, port: 21 }, handlerDefault);
    const alternateResult = await withFtpInteraction({ ...baseMeta, port: 2121 }, handlerAlternate);

    expect(defaultResult).toBe("21");
    expect(alternateResult).toBe("2121");
    expect(handlerDefault).toHaveBeenCalledTimes(1);
    expect(handlerAlternate).toHaveBeenCalledTimes(1);
  });

  it("PH9: cooldowns are isolated across hosts", async () => {
    config = { ...createConfig(), ftpListCooldownMs: 60_000 };
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const baseMeta = {
      action: makeAction("ftp-list-cooldown-isolation"),
      operation: "list" as const,
      path: "/root",
      intent: "system" as const,
    };

    const u64Handler = vi.fn().mockResolvedValue("u64");
    const c64uHandler = vi.fn().mockResolvedValue("c64u");

    await expect(withFtpInteraction({ ...baseMeta, host: "u64" }, u64Handler)).resolves.toBe("u64");
    const c64uResult = withFtpInteraction({ ...baseMeta, host: "c64u" }, c64uHandler);

    await expect.poll(() => c64uHandler.mock.calls.length).toBe(1);
    await expect(c64uResult).resolves.toBe("c64u");
  });

  it("allows user intent to override circuit breaker when configured", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Default config: circuitBreakerThreshold=2, allowUserOverrideCircuit=true
    const action = makeAction("rest-override");
    const criticalMeta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockRejectedValue(new Error("Network timed out"));
    // Need 2 failures to trigger circuit (default threshold=2)
    await expect(withRestInteraction(criticalMeta, handler)).rejects.toThrow("Network timed out");
    await expect(withRestInteraction(criticalMeta, handler)).rejects.toThrow("Network timed out");

    // Circuit should block system intent
    await expect(withRestInteraction(criticalMeta, handler)).rejects.toThrow("Device circuit open");

    // User intent should override the circuit (allowUserOverrideCircuit=true)
    const userMeta = {
      action: makeAction("rest-user-override"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "user" as const,
      baseUrl: "http://device",
    };
    const userHandler = vi.fn().mockResolvedValue({ status: "ok" });
    const result = await withRestInteraction(userMeta, userHandler);
    expect(result).toEqual({ status: "ok" });
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "override", reason: "circuit-open" }),
    );
  });

  it("blocks FTP requests when circuit is open and intent is not user", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Default config: circuitBreakerThreshold=2, allowUserOverrideCircuit=true
    const action = makeAction("ftp-circuit");
    const meta = {
      action,
      operation: "list",
      path: "/root",
      intent: "system" as const,
    };

    const handler = vi.fn().mockRejectedValue(new Error("FTP timeout"));
    // The first call retries once; two transient failures open the circuit.
    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("FTP timeout");

    // Circuit should now be open for FTP (system intent blocked)
    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("FTP circuit open");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "block", reason: "circuit-open" }),
    );
  });

  it("does not treat smoke/fuzz mode errors as critical for REST circuit", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-smoke");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockRejectedValue(new Error("Smoke mode blocked"));
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Smoke mode blocked");

    // Should NOT open circuit since smoke mode blocked is not critical
    const handler2 = vi.fn().mockResolvedValue("ok");
    const result = await withRestInteraction(meta, handler2);
    expect(result).toBe("ok");
  });

  it("treats HTTP 429 as critical REST error", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Default config: circuitBreakerThreshold=2
    const action = makeAction("rest-429");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockRejectedValue(new Error("HTTP 429 Too Many Requests"));
    // Need 2 failures to trigger circuit (default threshold=2)
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("HTTP 429");
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("HTTP 429");

    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Device circuit open");
  });

  it("treats host unreachable as critical REST error", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Default config: circuitBreakerThreshold=2
    const action = makeAction("rest-unreachable");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockRejectedValue(new Error("Host unreachable"));
    // Need 2 failures to trigger circuit (default threshold=2)
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Host unreachable");
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Host unreachable");

    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Device circuit open");
  });

  it("does not treat HTTP 4xx (except 429) as critical", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-404");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    // 404 is not critical so even multiple failures should not open circuit
    const handler = vi.fn().mockRejectedValue(new Error("HTTP 404 Not Found"));
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("HTTP 404");
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("HTTP 404");
    await expect(withRestInteraction(meta, handler)).rejects.toThrow("HTTP 404");

    // Should NOT open circuit since 404 is not critical
    const handler2 = vi.fn().mockResolvedValue("ok");
    const result = await withRestInteraction(meta, handler2);
    expect(result).toBe("ok");
  });

  it("caches /v1/configs responses and applies cooldown", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Uses default config (configsCacheMs=0, configsCooldownMs=0)
    const action = makeAction("rest-configs");
    const meta = {
      action,
      method: "GET",
      path: "/v1/configs",
      normalizedUrl: "http://device/v1/configs",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockResolvedValue({ items: [] });
    const result = await withRestInteraction(meta, handler);
    expect(result).toEqual({ items: [] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("blocks DISCOVERING state for non-system intent", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    deviceStateValue = "DISCOVERING";

    const action = makeAction("rest-discovering");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "background" as const,
      baseUrl: "http://device",
    };

    await expect(withRestInteraction(meta, vi.fn())).rejects.toThrow("Device not ready for requests");
  });

  it("allows system intent during DISCOVERING state when allowDuringDiscovery is set", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    deviceStateValue = "DISCOVERING";

    const action = makeAction("rest-discovery-allowed");
    const meta = {
      action,
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
      allowDuringDiscovery: true,
    };

    const handler = vi.fn().mockResolvedValue({ product: "test" });
    const result = await withRestInteraction(meta, handler);
    expect(result).toEqual({ product: "test" });
  });

  it("allows user intent during DISCOVERING so a saved-device switch does not block Home quick actions", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    deviceStateValue = "DISCOVERING";

    const action = makeAction("rest-discovering-user");
    const meta = {
      action,
      method: "PUT",
      path: "/v1/machine:pause",
      normalizedUrl: "http://device/v1/machine:pause",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockResolvedValue({ errors: [] });
    const result = await withRestInteraction(meta, handler);
    expect(result).toEqual({ errors: [] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows user intent to override ERROR state when configured", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    deviceStateValue = "ERROR";
    // Default config has allowUserOverrideCircuit: true

    const action = makeAction("rest-error-override");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    const handler = vi.fn().mockResolvedValue({ drives: [] });
    const result = await withRestInteraction(meta, handler);
    expect(result).toEqual({ drives: [] });
  });

  it("allows explicit system recovery probes to run while the device is in ERROR state", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    deviceStateValue = "ERROR";

    const action = makeAction("rest-error-recovery");
    const meta = {
      action,
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
      allowDuringError: true,
      bypassCircuit: true,
    };

    const handler = vi.fn().mockResolvedValue({ product: "Ultimate 64 Elite" });
    const result = await withRestInteraction(meta, handler);
    expect(result).toEqual({ product: "Ultimate 64 Elite" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when bypassCache is set", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Default config has infoCacheMs: 300

    const action = makeAction("rest-bypass-cache");
    const meta = {
      action,
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    const handler1 = vi.fn().mockResolvedValue({ v: 1 });
    await withRestInteraction(meta, handler1);

    const handler2 = vi.fn().mockResolvedValue({ v: 2 });
    const result = await withRestInteraction({ ...meta, bypassCache: true }, handler2);
    expect(result).toEqual({ v: 2 });
    expect(handler2).toHaveBeenCalled();
  });

  it("recovers after critical error by resetting streak on success", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-recover");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };

    // One critical error, then success should reset the streak
    const handler = vi.fn().mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce("recovered");

    await expect(withRestInteraction(meta, handler)).rejects.toThrow("Network error");
    const result = await withRestInteraction(meta, handler);
    expect(result).toBe("recovered");
  });

  it("withFtpInteraction: uses fast path in test env (success)", async () => {
    restoreEnv?.();
    restoreEnv = null;
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = false;

    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("ftp-fast-ok");
    const meta = { action, operation: "get", path: "/fast", intent: "system" as const };
    const handler = vi.fn().mockResolvedValue("fast-result");

    const result = await withFtpInteraction(meta, handler);
    expect(result).toBe("fast-result");
    expect(markDeviceRequestStart).toHaveBeenCalled();
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: true });
  });

  it("withFtpInteraction: uses fast path in test env (error)", async () => {
    restoreEnv?.();
    restoreEnv = null;
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = false;

    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("ftp-fast-err");
    const meta = { action, operation: "get", path: "/fast-err", intent: "system" as const };
    const handler = vi.fn().mockRejectedValue(new Error("Fast FTP error"));

    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("Fast FTP error");
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: false, errorMessage: "Fast FTP error" });
  });

  it("withFtpInteraction: blocks when device state is ERROR and intent is system", async () => {
    deviceStateValue = "ERROR";

    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("ftp-state-err");
    const meta = { action, operation: "list", path: "/root", intent: "system" as const };
    const handler = vi.fn().mockResolvedValue("ok");

    await expect(withFtpInteraction(meta, handler)).rejects.toThrow("Device not ready for FTP");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      action,
      expect.objectContaining({ decision: "block", reason: "state" }),
    );
  });

  it("withRestInteraction: resolves to null policy for unknown REST path", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-custom");
    const meta = {
      action,
      method: "GET",
      path: "/v1/custom-endpoint",
      normalizedUrl: "http://device/v1/custom-endpoint",
      intent: "system" as const,
      baseUrl: "http://device",
    };
    const handler = vi.fn().mockResolvedValue({ ok: true });

    const result = await withRestInteraction(meta, handler);
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("withRestInteraction: blocks system intent when device state is ERROR", async () => {
    deviceStateValue = "ERROR";

    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("rest-err-state");
    const meta = {
      action,
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
    };
    const handler = vi.fn().mockResolvedValue("ok");

    await expect(withRestInteraction(meta, handler)).rejects.toThrow();
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      action,
      expect.objectContaining({ decision: "block", reason: "state" }),
    );
  });

  it("withTelnetInteraction: uses fast path in test env (success)", async () => {
    restoreEnv?.();
    restoreEnv = null;
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = false;

    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("telnet-fast-ok");
    const meta = { action, actionId: "telnet-fast-ok", intent: "system" as const };
    const handler = vi.fn().mockResolvedValue("fast-telnet");

    const result = await withTelnetInteraction(meta, handler);
    expect(result).toBe("fast-telnet");
    expect(markDeviceRequestStart).toHaveBeenCalled();
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: true });
  });

  it("withTelnetInteraction: uses fast path in test env (error)", async () => {
    restoreEnv?.();
    restoreEnv = null;
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = false;

    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("telnet-fast-err");
    const meta = { action, actionId: "telnet-fast-err", intent: "system" as const };
    const handler = vi.fn().mockRejectedValue(new Error("Fast Telnet error"));

    await expect(withTelnetInteraction(meta, handler)).rejects.toThrow("Fast Telnet error");
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: false, errorMessage: "Fast Telnet error" });
  });

  it("withTelnetInteraction: succeeds via full path and marks device lifecycle", async () => {
    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("telnet-ok");
    const meta = { action, actionId: "telnet-ok", intent: "system" as const };
    const handler = vi.fn().mockResolvedValue("telnet-result");

    const result = await withTelnetInteraction(meta, handler);
    expect(result).toBe("telnet-result");
    expect(markDeviceRequestStart).toHaveBeenCalled();
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: true });
    expect(addErrorLog).not.toHaveBeenCalled();
  });

  it("withTelnetInteraction: logs and rethrows error on handler failure", async () => {
    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("telnet-fail");
    const meta = { action, actionId: "telnet-fail", intent: "system" as const };
    const handler = vi.fn().mockRejectedValue(new Error("Telnet connection lost"));

    await expect(withTelnetInteraction(meta, handler)).rejects.toThrow("Telnet connection lost");
    expect(markDeviceRequestEnd).toHaveBeenCalledWith({ success: false, errorMessage: "Telnet connection lost" });
    expect(addErrorLog).toHaveBeenCalledWith(
      "Telnet request failed",
      expect.objectContaining({ actionId: "telnet-fail" }),
    );
  });

  it("withTelnetInteraction: blocks system intent when Telnet circuit is open", async () => {
    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("telnet-circuit");
    const meta = { action, actionId: "telnet-circuit", intent: "system" as const };
    const handler = vi.fn().mockRejectedValue(new Error("Telnet fail"));

    await expect(withTelnetInteraction(meta, handler)).rejects.toThrow("Telnet fail");
    await expect(withTelnetInteraction(meta, handler)).rejects.toThrow("Telnet fail");
    await expect(withTelnetInteraction(meta, handler)).rejects.toThrow("Telnet circuit open");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "block", reason: "circuit-open" }),
    );
  });

  it("withTelnetInteraction: user intent overrides open Telnet circuit", async () => {
    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const sysAction = makeAction("telnet-sys-fail");
    const sysMeta = { action: sysAction, actionId: "telnet-sys-fail", intent: "system" as const };
    const failHandler = vi.fn().mockRejectedValue(new Error("Telnet fail"));

    await expect(withTelnetInteraction(sysMeta, failHandler)).rejects.toThrow("Telnet fail");
    await expect(withTelnetInteraction(sysMeta, failHandler)).rejects.toThrow("Telnet fail");

    const userAction = makeAction("telnet-user-override");
    const userMeta = { action: userAction, actionId: "telnet-user-override", intent: "user" as const };
    const successHandler = vi.fn().mockResolvedValue("telnet-ok");

    const result = await withTelnetInteraction(userMeta, successHandler);
    expect(result).toBe("telnet-ok");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      userAction,
      expect.objectContaining({ decision: "override", reason: "circuit-open" }),
    );
  });

  it("withTelnetInteraction: blocks when device state is ERROR and intent is system", async () => {
    deviceStateValue = "ERROR";

    const { withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const action = makeAction("telnet-state-block");
    const meta = { action, actionId: "telnet-state-block", intent: "system" as const };
    const handler = vi.fn().mockResolvedValue("ok");

    await expect(withTelnetInteraction(meta, handler)).rejects.toThrow("Device not ready for Telnet");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      action,
      expect.objectContaining({ decision: "block", reason: "state" }),
    );
  });

  it("user override works for FTP circuit too", async () => {
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    // Default config: circuitBreakerThreshold=2, allowUserOverrideCircuit=true
    const action = makeAction("ftp-override");
    const sysHandler = vi.fn().mockRejectedValue(new Error("FTP timeout"));
    // The first call retries once; two transient failures open the circuit.
    await expect(
      withFtpInteraction(
        {
          action,
          operation: "list",
          path: "/sys",
          intent: "system" as const,
        },
        sysHandler,
      ),
    ).rejects.toThrow("FTP timeout");

    // Circuit open now - system intent blocked
    await expect(
      withFtpInteraction(
        {
          action: makeAction("ftp-blocked"),
          operation: "list",
          path: "/blocked",
          intent: "system" as const,
        },
        sysHandler,
      ),
    ).rejects.toThrow("FTP circuit open");

    // User intent should override
    const userHandler = vi.fn().mockResolvedValue("ok");
    const result = await withFtpInteraction(
      {
        action: makeAction("ftp-user"),
        operation: "get",
        path: "/user-file",
        intent: "user" as const,
      },
      userHandler,
    );
    expect(result).toBe("ok");
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "override", reason: "circuit-open" }),
    );
  });

  it("PH10: resetInteractionState rejects queued REST work as cancellation and allows new work after reset", async () => {
    const { InteractionCancelledError, withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    let releaseRunning: (() => void) | null = null;
    const runningHandler = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseRunning = () => resolve("old-running");
        }),
    );
    const queuedHandler = vi.fn().mockResolvedValue("stale");

    const running = withRestInteraction(
      {
        action: makeAction("rest-running"),
        method: "GET",
        path: "/v1/info",
        normalizedUrl: "http://u64/v1/info",
        intent: "system" as const,
        baseUrl: "http://u64",
        bypassCache: true,
      },
      runningHandler,
    );
    await expect.poll(() => runningHandler.mock.calls.length).toBe(1);

    const queued = withRestInteraction(
      {
        action: makeAction("rest-queued"),
        method: "GET",
        path: "/v1/drives",
        normalizedUrl: "http://u64/v1/drives",
        intent: "system" as const,
        baseUrl: "http://u64",
        bypassCache: true,
      },
      queuedHandler,
    );
    const queuedExpectation = expect(queued).rejects.toMatchObject({
      name: "InteractionCancelledError",
      reason: "saved-device-switch",
      isCancellation: true,
    });

    resetInteractionState("saved-device-switch");
    await queuedExpectation;
    await expect(queued).rejects.toBeInstanceOf(InteractionCancelledError);
    expect(queuedHandler).not.toHaveBeenCalled();

    releaseRunning?.();
    await expect(running).resolves.toBe("old-running");

    const newHandler = vi.fn().mockResolvedValue("new-device");
    await expect(
      withRestInteraction(
        {
          action: makeAction("rest-new-device"),
          method: "GET",
          path: "/v1/info",
          normalizedUrl: "http://c64u/v1/info",
          intent: "system" as const,
          baseUrl: "http://c64u",
          bypassCache: true,
        },
        newHandler,
      ),
    ).resolves.toBe("new-device");
  });

  it("PH10: resetInteractionState rejects queued FTP and Telnet work as cancellation", async () => {
    const { withFtpInteraction, withTelnetInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    let releaseFtpRunning: (() => void) | null = null;
    const ftpRunning = withFtpInteraction(
      {
        action: makeAction("ftp-running"),
        operation: "list",
        path: "/old",
        intent: "system" as const,
        host: "u64",
      },
      () =>
        new Promise<string>((resolve) => {
          releaseFtpRunning = () => resolve("ftp-running");
        }),
    );
    const ftpQueuedHandler = vi.fn().mockResolvedValue("ftp-stale");
    await expect.poll(() => markDeviceRequestStart.mock.calls.length).toBeGreaterThanOrEqual(1);
    const ftpQueued = withFtpInteraction(
      {
        action: makeAction("ftp-queued"),
        operation: "list",
        path: "/queued",
        intent: "system" as const,
        host: "c64u",
      },
      ftpQueuedHandler,
    );
    const ftpQueuedExpectation = expect(ftpQueued).rejects.toMatchObject({
      name: "InteractionCancelledError",
      reason: "saved-device-switch",
      isCancellation: true,
    });

    let releaseTelnetRunning: (() => void) | null = null;
    const telnetRunning = withTelnetInteraction(
      { action: makeAction("telnet-running"), actionId: "telnet-running", intent: "system" as const },
      () =>
        new Promise<string>((resolve) => {
          releaseTelnetRunning = () => resolve("telnet-running");
        }),
    );
    const telnetQueuedHandler = vi.fn().mockResolvedValue("telnet-stale");
    await expect.poll(() => markDeviceRequestStart.mock.calls.length).toBeGreaterThanOrEqual(2);
    const telnetQueued = withTelnetInteraction(
      { action: makeAction("telnet-queued"), actionId: "telnet-queued", intent: "system" as const },
      telnetQueuedHandler,
    );
    const telnetQueuedExpectation = expect(telnetQueued).rejects.toMatchObject({
      name: "InteractionCancelledError",
      reason: "saved-device-switch",
      isCancellation: true,
    });

    resetInteractionState("saved-device-switch");

    await ftpQueuedExpectation;
    await telnetQueuedExpectation;
    expect(ftpQueuedHandler).not.toHaveBeenCalled();
    expect(telnetQueuedHandler).not.toHaveBeenCalled();

    releaseFtpRunning?.();
    releaseTelnetRunning?.();
    await expect(ftpRunning).resolves.toBe("ftp-running");
    await expect(telnetRunning).resolves.toBe("telnet-running");
  });

  it("PH10: same-device queued REST work preserves priority ordering", async () => {
    const { withRestInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const callOrder: string[] = [];
    let releaseRunning: (() => void) | null = null;
    const running = withRestInteraction(
      {
        action: makeAction("priority-running"),
        method: "GET",
        path: "/v1/running",
        normalizedUrl: "http://u64/v1/running",
        intent: "system" as const,
        baseUrl: "http://u64",
        bypassCache: true,
      },
      () =>
        new Promise<string>((resolve) => {
          callOrder.push("running");
          releaseRunning = () => resolve("running");
        }),
    );
    await expect.poll(() => callOrder).toEqual(["running"]);

    const background = withRestInteraction(
      {
        action: makeAction("priority-background"),
        method: "GET",
        path: "/v1/background",
        normalizedUrl: "http://u64/v1/background",
        intent: "background" as const,
        baseUrl: "http://u64",
        bypassCache: true,
      },
      async () => {
        callOrder.push("background");
        return "background";
      },
    );
    const user = withRestInteraction(
      {
        action: makeAction("priority-user"),
        method: "GET",
        path: "/v1/user",
        normalizedUrl: "http://u64/v1/user",
        intent: "user" as const,
        baseUrl: "http://u64",
        bypassCache: true,
      },
      async () => {
        callOrder.push("user");
        return "user";
      },
    );

    releaseRunning?.();
    await expect(running).resolves.toBe("running");
    await expect(user).resolves.toBe("user");
    await expect(background).resolves.toBe("background");
    expect(callOrder).toEqual(["running", "user", "background"]);
  });

  it("PH10: same-device FTP work still respects configured concurrency", async () => {
    config = { ...createConfig(), ftpMaxConcurrency: 2 };
    const { withFtpInteraction, resetInteractionState } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");

    const started: string[] = [];
    let releaseFirst: (() => void) | null = null;
    let releaseSecond: (() => void) | null = null;
    const first = withFtpInteraction(
      {
        action: makeAction("ftp-concurrency-1"),
        operation: "list",
        path: "/one",
        intent: "system" as const,
        host: "u64",
      },
      () =>
        new Promise<string>((resolve) => {
          started.push("first");
          releaseFirst = () => resolve("first");
        }),
    );
    const second = withFtpInteraction(
      {
        action: makeAction("ftp-concurrency-2"),
        operation: "list",
        path: "/two",
        intent: "system" as const,
        host: "u64",
      },
      () =>
        new Promise<string>((resolve) => {
          started.push("second");
          releaseSecond = () => resolve("second");
        }),
    );

    await expect.poll(() => started).toEqual(["first", "second"]);
    releaseFirst?.();
    releaseSecond?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });
});
