/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceSafetyMode } from "@/lib/config/deviceSafetySettings";
import {
  loadDeviceSafetyConfig,
  loadDeviceSafetyMode,
  resetDeviceSafetyOverrides,
  saveAllowUserOverrideCircuit,
  saveDeviceSafetyMode,
  saveFtpMaxConcurrency,
  saveRestMaxConcurrency,
  subscribeDeviceSafetyUpdates,
  DEVICE_SAFETY_SETTING_KEYS,
} from "@/lib/config/deviceSafetySettings";

type ExpectedDefaults = {
  restMaxConcurrency: number;
  ftpMaxConcurrency: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffFactor: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
};

const MODE_EXPECTATIONS: Record<DeviceSafetyMode, ExpectedDefaults> = {
  RELAXED: {
    restMaxConcurrency: 2,
    ftpMaxConcurrency: 2,
    backoffBaseMs: 150,
    backoffMaxMs: 1500,
    backoffFactor: 1.5,
    circuitBreakerThreshold: 6,
    circuitBreakerCooldownMs: 2000,
  },
  BALANCED: {
    restMaxConcurrency: 2,
    ftpMaxConcurrency: 1,
    backoffBaseMs: 300,
    backoffMaxMs: 3000,
    backoffFactor: 1.8,
    circuitBreakerThreshold: 4,
    circuitBreakerCooldownMs: 4000,
  },
  CONSERVATIVE: {
    restMaxConcurrency: 1,
    ftpMaxConcurrency: 1,
    backoffBaseMs: 500,
    backoffMaxMs: 6000,
    backoffFactor: 2,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 6000,
  },
  TROUBLESHOOTING: {
    restMaxConcurrency: 1,
    ftpMaxConcurrency: 1,
    backoffBaseMs: 200,
    backoffMaxMs: 1200,
    backoffFactor: 1.4,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 2000,
  },
};

describe("deviceSafetySettings defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(Object.entries(MODE_EXPECTATIONS))("loads %s defaults", (mode, expected) => {
    saveDeviceSafetyMode(mode as DeviceSafetyMode);

    const config = loadDeviceSafetyConfig();

    expect(config.restMaxConcurrency).toBe(expected.restMaxConcurrency);
    expect(config.ftpMaxConcurrency).toBe(expected.ftpMaxConcurrency);
    expect(config.backoffBaseMs).toBe(expected.backoffBaseMs);
    expect(config.backoffMaxMs).toBe(expected.backoffMaxMs);
    expect(config.backoffFactor).toBeCloseTo(expected.backoffFactor, 6);
    expect(config.circuitBreakerThreshold).toBe(expected.circuitBreakerThreshold);
    expect(config.circuitBreakerCooldownMs).toBe(expected.circuitBreakerCooldownMs);
  });

  it("keeps REST and FTP concurrency independent", () => {
    saveDeviceSafetyMode("BALANCED");

    saveRestMaxConcurrency(4);
    let config = loadDeviceSafetyConfig();
    expect(config.restMaxConcurrency).toBe(4);
    expect(config.ftpMaxConcurrency).toBe(1);

    saveFtpMaxConcurrency(3);
    config = loadDeviceSafetyConfig();
    expect(config.restMaxConcurrency).toBe(4);
    expect(config.ftpMaxConcurrency).toBe(3);
  });
});

describe("deviceSafetySettings undefined-environment branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("readString/readNumber/readBoolean return null when localStorage undefined (lines 115, 121, 129)", () => {
    vi.stubGlobal("localStorage", undefined);
    // loadDeviceSafetyMode calls readString; loadDeviceSafetyConfig calls readNumber + readBoolean
    expect(loadDeviceSafetyMode()).toBe("BALANCED");
    const config = loadDeviceSafetyConfig();
    expect(config.mode).toBe("BALANCED");
    expect(config.restMaxConcurrency).toBe(2);
  });

  it("readNumber returns null for non-finite stored value (line 125 FALSE)", () => {
    localStorage.setItem(DEVICE_SAFETY_SETTING_KEYS.REST_MAX_CONCURRENCY_KEY, "not-a-number");
    const config = loadDeviceSafetyConfig();
    // Falls back to default (BALANCED = 2)
    expect(config.restMaxConcurrency).toBe(2);
  });

  it("broadcast is skipped when window is undefined (line 147)", () => {
    vi.stubGlobal("window", undefined);
    // Should not throw
    saveDeviceSafetyMode("RELAXED");
    vi.unstubAllGlobals();
    expect(localStorage.getItem(DEVICE_SAFETY_SETTING_KEYS.DEVICE_SAFETY_MODE_KEY)).toBe("RELAXED");
  });

  it("subscribeDeviceSafetyUpdates returns no-op when window is undefined (line 152)", () => {
    vi.stubGlobal("window", undefined);
    const unsubscribe = subscribeDeviceSafetyUpdates(() => {});
    expect(typeof unsubscribe).toBe("function");
    // No error thrown
    unsubscribe();
  });

  it("saveDeviceSafetyMode returns early when localStorage undefined (line 163)", () => {
    vi.stubGlobal("localStorage", undefined);
    // Should not throw
    saveDeviceSafetyMode("CONSERVATIVE");
  });

  it("resetDeviceSafetyOverrides returns early when localStorage undefined", () => {
    vi.stubGlobal("localStorage", undefined);
    // Should not throw
    resetDeviceSafetyOverrides();
  });

  it("saveAllowUserOverrideCircuit stores false as 0 (line 230 FALSE)", () => {
    saveAllowUserOverrideCircuit(false);
    expect(localStorage.getItem(DEVICE_SAFETY_SETTING_KEYS.ALLOW_USER_OVERRIDE_CIRCUIT_KEY)).toBe("0");
  });
});
