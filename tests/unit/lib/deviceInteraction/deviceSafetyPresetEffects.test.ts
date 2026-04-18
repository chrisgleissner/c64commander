import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceSafetyConfig, DeviceSafetyMode } from "@/lib/config/deviceSafetySettings";
import type { DeviceState } from "@/lib/deviceInteraction/deviceStateStore";
import type { TraceActionContext } from "@/lib/tracing/types";

const MODE_CONFIGS: Record<DeviceSafetyMode, DeviceSafetyConfig> = {
  RELAXED: {
    mode: "RELAXED",
    ftpMaxConcurrency: 3,
    infoCacheMs: 200,
    configsCacheMs: 400,
    configsCooldownMs: 200,
    drivesCooldownMs: 200,
    ftpListCooldownMs: 100,
    backoffBaseMs: 100,
    backoffMaxMs: 1500,
    backoffFactor: 1.5,
    circuitBreakerThreshold: 6,
    circuitBreakerCooldownMs: 2000,
    discoveryProbeIntervalMs: 400,
    allowUserOverrideCircuit: true,
  },
  BALANCED: {
    mode: "BALANCED",
    ftpMaxConcurrency: 2,
    infoCacheMs: 600,
    configsCacheMs: 1000,
    configsCooldownMs: 500,
    drivesCooldownMs: 500,
    ftpListCooldownMs: 300,
    backoffBaseMs: 200,
    backoffMaxMs: 3000,
    backoffFactor: 1.8,
    circuitBreakerThreshold: 4,
    circuitBreakerCooldownMs: 4000,
    discoveryProbeIntervalMs: 700,
    allowUserOverrideCircuit: true,
  },
  CONSERVATIVE: {
    mode: "CONSERVATIVE",
    ftpMaxConcurrency: 1,
    infoCacheMs: 1200,
    configsCacheMs: 2000,
    configsCooldownMs: 1200,
    drivesCooldownMs: 1000,
    ftpListCooldownMs: 800,
    backoffBaseMs: 300,
    backoffMaxMs: 6000,
    backoffFactor: 2,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 6000,
    discoveryProbeIntervalMs: 1000,
    allowUserOverrideCircuit: false,
  },
  TROUBLESHOOTING: {
    mode: "TROUBLESHOOTING",
    ftpMaxConcurrency: 1,
    infoCacheMs: 300,
    configsCacheMs: 600,
    configsCooldownMs: 300,
    drivesCooldownMs: 300,
    ftpListCooldownMs: 200,
    backoffBaseMs: 200,
    backoffMaxMs: 1200,
    backoffFactor: 1.4,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 2000,
    discoveryProbeIntervalMs: 500,
    allowUserOverrideCircuit: true,
  },
};

let config: DeviceSafetyConfig = MODE_CONFIGS.BALANCED;
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

const makeAction = (name = "preset-test"): TraceActionContext => ({
  correlationId: `trace-${name}`,
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

describe("device safety preset effects", () => {
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    (globalThis as { __c64uForceInteractionScheduling?: boolean }).__c64uForceInteractionScheduling = true;
    restoreEnv = applyNonTestEnv();
    config = MODE_CONFIGS.BALANCED;
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

  it.each(Object.entries(MODE_CONFIGS))(
    "applies %s FTP concurrency to queued interactions",
    async (_mode, modeConfig) => {
      config = modeConfig;

      const { resetInteractionState, withFtpInteraction } =
        await import("@/lib/deviceInteraction/deviceInteractionManager");
      resetInteractionState("test");

      let activeHandlers = 0;
      let maxActiveHandlers = 0;
      const handler = vi.fn(async () => {
        activeHandlers += 1;
        maxActiveHandlers = Math.max(maxActiveHandlers, activeHandlers);
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            activeHandlers -= 1;
            resolve();
          }, 25);
        });
      });

      const requests = Array.from({ length: modeConfig.ftpMaxConcurrency + 2 }, (_, index) =>
        withFtpInteraction(
          {
            action: makeAction(`ftp-${index}`),
            operation: "list",
            path: `/disk-${index}`,
            intent: "system",
          },
          handler,
        ),
      );

      await expect(Promise.all(requests)).resolves.toEqual(
        Array.from({ length: modeConfig.ftpMaxConcurrency + 2 }, () => undefined),
      );
      expect(maxActiveHandlers).toBe(modeConfig.ftpMaxConcurrency);
    },
  );

  it.each(Object.entries(MODE_CONFIGS))(
    "applies %s circuit threshold and override policy to REST failures",
    async (_mode, modeConfig) => {
      config = modeConfig;

      const { resetInteractionState, withRestInteraction } =
        await import("@/lib/deviceInteraction/deviceInteractionManager");
      resetInteractionState("test");

      const systemMeta = {
        action: makeAction("rest-system"),
        method: "GET",
        path: "/v1/drives",
        normalizedUrl: "http://device/v1/drives",
        intent: "system" as const,
        baseUrl: "http://device",
        bypassBackoff: true,
      };
      const userMeta = {
        ...systemMeta,
        action: makeAction("rest-user"),
        intent: "user" as const,
      };

      const failingHandler = vi.fn().mockRejectedValue(new Error("Network timed out"));
      for (let index = 0; index < modeConfig.circuitBreakerThreshold; index += 1) {
        await expect(withRestInteraction(systemMeta, failingHandler)).rejects.toThrow("Network timed out");
      }

      await expect(withRestInteraction(systemMeta, vi.fn().mockResolvedValue({ ok: true }))).rejects.toThrow(
        "Device circuit open",
      );

      const userHandler = vi.fn().mockResolvedValue({ ok: true });
      if (modeConfig.allowUserOverrideCircuit) {
        await expect(withRestInteraction(userMeta, userHandler)).resolves.toEqual({ ok: true });
      } else {
        await expect(withRestInteraction(userMeta, userHandler)).rejects.toThrow("Device circuit open");
      }
    },
  );
});
