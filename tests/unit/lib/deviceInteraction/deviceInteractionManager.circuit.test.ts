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

  it("forces an explicit probe past the ERROR state gate that blocks a normal user request", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");
    deviceStateValue = "ERROR";

    const userMeta = {
      action: makeAction("rest-error-blocked"),
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "user" as const,
      baseUrl: "http://device",
    };

    // The wedge: a normal user request while the device is in ERROR (with the
    // CONSERVATIVE default allowUserOverrideCircuit:false) is rejected before
    // any socket opens, so an explicit health check would report "offline".
    await expect(withRestInteraction(userMeta, vi.fn().mockResolvedValue({ ok: true }))).rejects.toThrow(
      "Device not ready for requests",
    );

    // A user-forced probe (manual health check) overrides the state gate and
    // reaches the handler, so the device's real state is always observable.
    const forcedHandler = vi.fn().mockResolvedValue({ product: "C64 Ultimate" });
    await expect(
      withRestInteraction(
        {
          ...userMeta,
          action: makeAction("rest-error-forced"),
          forceProbe: true,
          bypassCircuit: true,
          bypassBackoff: true,
          bypassCooldown: true,
        },
        forcedHandler,
      ),
    ).resolves.toEqual({ product: "C64 Ultimate" });
    expect(forcedHandler).toHaveBeenCalledTimes(1);
    expect(recordDeviceGuard).toHaveBeenCalledWith(
      expect.objectContaining({ name: "rest-error-forced" }),
      expect.objectContaining({ decision: "override", reason: "state" }),
    );
  });

  it("forces an explicit probe past an open REST circuit (self-healing recovery path)", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");
    deviceStateValue = "READY";

    const systemMeta = {
      action: makeAction("rest-circuit-noise"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "system" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
      bypassCache: true,
    };

    const failingHandler = vi.fn().mockRejectedValue(new Error("Network error"));
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");
    await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network error");

    // Circuit now open: an ordinary system probe is refused with no socket.
    await expect(withRestInteraction(systemMeta, vi.fn().mockResolvedValue({ ok: true }))).rejects.toThrow(
      "Device circuit open",
    );

    // A forced probe bypasses the open circuit and reaches the wire, so an open
    // breaker can never starve the very check that would detect recovery.
    const forcedHandler = vi.fn().mockResolvedValue({ ok: true });
    await expect(
      withRestInteraction(
        { ...systemMeta, action: makeAction("rest-circuit-forced"), forceProbe: true, bypassCircuit: true },
        forcedHandler,
      ),
    ).resolves.toEqual({ ok: true });
    expect(forcedHandler).toHaveBeenCalledTimes(1);
  });

  it("never trips the breaker from a suppress-contribution probe, however many times it fails", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    resetInteractionState("test");
    deviceStateValue = "READY";

    // A diagnostic/health probe (device switcher, background maintenance) must
    // NOT feed the circuit streak - this is the escalation the user hit, where a
    // couple of health-probe blips escalated to the whole device being "offline
    // / circuit open" until app restart.
    const probeMeta = {
      action: makeAction("rest-health-probe"),
      method: "GET",
      path: "/v1/info",
      normalizedUrl: "http://device/v1/info",
      intent: "system" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
      bypassCooldown: true,
      bypassCache: true,
      suppressCircuitContribution: true,
    };

    const failing = vi.fn().mockRejectedValue(new Error("Network error"));
    // Five failures - well past the CONSERVATIVE threshold of 2. Without the
    // suppression these would open the circuit after two.
    for (let i = 0; i < 5; i += 1) {
      const attempt = withRestInteraction(probeMeta, failing);
      void attempt.catch(() => undefined);
      await vi.runOnlyPendingTimersAsync();
      await expect(attempt).rejects.toThrow("Network error");
    }

    // The circuit was never OPENED (opening calls it with a numeric deadline +
    // message; a null call is just the reset), so ordinary user traffic is NOT
    // blocked.
    expect(setCircuitOpenUntil).not.toHaveBeenCalledWith(expect.any(Number), expect.any(String));
    const userHandler = vi.fn().mockResolvedValue({ ok: true });
    const userAttempt = withRestInteraction(
      { ...probeMeta, action: makeAction("user-after"), suppressCircuitContribution: false },
      userHandler,
    );
    await vi.runOnlyPendingTimersAsync();
    await expect(userAttempt).resolves.toEqual({ ok: true });
    expect(userHandler).toHaveBeenCalledTimes(1);
  });

  // HARD18-012b: a power-cycle success arms a bounded expected-outage window
  // (beginMachineTransition with a long cooldown) so boot-time poll failures
  // do not trip the breaker seconds after the app told the user "Power
  // cycled" - the same suppression the diagnostic-probe test above proves
  // for suppressCircuitContribution, but sourced from a deliberate machine
  // transition instead of a per-request opt-in flag.
  it("does not trip the breaker for ordinary REST failures while an expected machine-transition window is active", async () => {
    const { resetInteractionState, withRestInteraction } =
      await import("@/lib/deviceInteraction/deviceInteractionManager");
    const { beginMachineTransition, resetDeviceActivityGate } =
      await import("@/lib/deviceInteraction/deviceActivityGate");
    resetInteractionState("test");
    resetDeviceActivityGate();
    deviceStateValue = "READY";

    // Uses "user" intent (not "system"/"background") deliberately: a
    // read-only system/background request would additionally be routed
    // through withRestInteraction's pre-existing areBackgroundReadsSuspended
    // wait (HARD18-026) while the transition is active, which is a distinct
    // mechanism from the circuit-breaker suppression this test targets.
    // "user" isolates the one behavior under test.
    const meta = {
      action: makeAction("rest-power-cycle-outage"),
      method: "GET",
      path: "/v1/drives",
      normalizedUrl: "http://device/v1/drives",
      intent: "user" as const,
      baseUrl: "http://device",
      bypassBackoff: true,
      bypassCooldown: true,
      bypassCache: true,
    };

    // Arms the window starting now (begin, then immediately end applies the
    // cooldown from this moment) - mirrors HomePage's handlePowerCycle.
    //
    // NOTE: uses advanceTimersByTimeAsync(0), not runOnlyPendingTimersAsync(),
    // below. Arming the window schedules deviceActivityGate's own
    // expiry-notification setTimeout ~18s out; "run ALL pending timers" would
    // fire that timer too and jump fake time straight to the window's edge,
    // defeating the very cooldown this test is proving. Advancing by 0ms still
    // flushes the scheduler's own zero-delay queue tick without touching it.
    beginMachineTransition(18_000)();

    const failing = vi.fn().mockRejectedValue(new Error("Network error"));
    for (let i = 0; i < 5; i += 1) {
      const attempt = withRestInteraction(meta, failing);
      void attempt.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      await expect(attempt).rejects.toThrow("Network error");
    }

    // The circuit was never OPENED (opening calls it with a numeric deadline
    // + message; a null call is just the reset), so ordinary user traffic is
    // NOT blocked.
    expect(setCircuitOpenUntil).not.toHaveBeenCalledWith(expect.any(Number), expect.any(String));
    const userHandler = vi.fn().mockResolvedValue({ ok: true });
    const userAttempt = withRestInteraction({ ...meta, action: makeAction("user-after") }, userHandler);
    await vi.advanceTimersByTimeAsync(0);
    await expect(userAttempt).resolves.toEqual({ ok: true });
    expect(userHandler).toHaveBeenCalledTimes(1);
  });
});
