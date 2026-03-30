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
  subscribeDeviceSafetyUpdates,
  DEVICE_SAFETY_SETTING_KEYS,
} from "@/lib/config/deviceSafetySettings";

type ExpectedDefaults = {
  ftpMaxConcurrency: number;
  infoCacheMs: number;
  configsCacheMs: number;
  configsCooldownMs: number;
  drivesCooldownMs: number;
  ftpListCooldownMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffFactor: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  discoveryProbeIntervalMs: number;
  allowUserOverrideCircuit: boolean;
};

const MODE_EXPECTATIONS: Record<DeviceSafetyMode, ExpectedDefaults> = {
  RELAXED: {
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

describe("deviceSafetySettings defaults", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(Object.entries(MODE_EXPECTATIONS))("loads %s defaults", (mode, expected) => {
    saveDeviceSafetyMode(mode as DeviceSafetyMode);

    const config = loadDeviceSafetyConfig();

    expect(config.ftpMaxConcurrency).toBe(expected.ftpMaxConcurrency);
    expect(config.infoCacheMs).toBe(expected.infoCacheMs);
    expect(config.configsCacheMs).toBe(expected.configsCacheMs);
    expect(config.configsCooldownMs).toBe(expected.configsCooldownMs);
    expect(config.drivesCooldownMs).toBe(expected.drivesCooldownMs);
    expect(config.ftpListCooldownMs).toBe(expected.ftpListCooldownMs);
    expect(config.backoffBaseMs).toBe(expected.backoffBaseMs);
    expect(config.backoffMaxMs).toBe(expected.backoffMaxMs);
    expect(config.backoffFactor).toBeCloseTo(expected.backoffFactor, 6);
    expect(config.circuitBreakerThreshold).toBe(expected.circuitBreakerThreshold);
    expect(config.circuitBreakerCooldownMs).toBe(expected.circuitBreakerCooldownMs);
    expect(config.discoveryProbeIntervalMs).toBe(expected.discoveryProbeIntervalMs);
    expect(config.allowUserOverrideCircuit).toBe(expected.allowUserOverrideCircuit);
  });

  it("keeps FTP concurrency independent from cache overrides", () => {
    saveDeviceSafetyMode("BALANCED");

    saveFtpMaxConcurrency(3);
    const config = loadDeviceSafetyConfig();

    expect(config.ftpMaxConcurrency).toBe(3);
    expect(config.configsCacheMs).toBe(MODE_EXPECTATIONS.BALANCED.configsCacheMs);
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
    expect(config.ftpMaxConcurrency).toBe(2);
  });

  it("readNumber returns null for non-finite stored value (line 125 FALSE)", () => {
    localStorage.setItem(DEVICE_SAFETY_SETTING_KEYS.FTP_MAX_CONCURRENCY_KEY, "not-a-number");
    const config = loadDeviceSafetyConfig();
    expect(config.ftpMaxConcurrency).toBe(2);
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

  it("resetDeviceSafetyOverrides removes all override keys and broadcasts reset", () => {
    // Set some override keys in localStorage
    const keys = Object.values(DEVICE_SAFETY_SETTING_KEYS);
    keys.forEach((key) => localStorage.setItem(key, "42"));

    resetDeviceSafetyOverrides();

    keys.forEach((key) => {
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  it("saveAllowUserOverrideCircuit stores false as 0 (line 230 FALSE)", () => {
    saveAllowUserOverrideCircuit(false);
    expect(localStorage.getItem(DEVICE_SAFETY_SETTING_KEYS.ALLOW_USER_OVERRIDE_CIRCUIT_KEY)).toBe("0");
  });
});
