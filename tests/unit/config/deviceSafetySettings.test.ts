/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SafetyModules = {
  safety: typeof import("@/lib/config/deviceSafetySettings");
  store: typeof import("@/lib/savedDevices/store");
};

const BALANCED_EXPECTATIONS = {
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
};

const CONSERVATIVE_EXPECTATIONS = {
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
};

const loadModules = async (): Promise<SafetyModules> => {
  vi.resetModules();
  const [safety, store] = await Promise.all([
    import("@/lib/config/deviceSafetySettings"),
    import("@/lib/savedDevices/store"),
  ]);
  return { safety, store };
};

const addSwitchableDevices = async () => {
  const modules = await loadModules();
  const { store } = modules;
  const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;

  store.updateSavedDevice(initialDeviceId, {
    name: "Office U64",
    host: "u64",
    lastKnownProduct: "U64",
    lastKnownHostname: "u64",
    lastKnownUniqueId: "UID-U64",
  });
  store.addSavedDevice({
    id: "device-c64u",
    name: "Legacy C64U",
    host: "c64u",
    httpPort: 80,
    ftpPort: 21,
    telnetPort: 23,
    lastKnownProduct: "C64U",
    lastKnownHostname: "c64u",
    lastKnownUniqueId: "UID-C64U",
    hasPassword: false,
  });

  return { ...modules, initialDeviceId };
};

describe("deviceSafetySettings AUTO mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("resolves AUTO to CONSERVATIVE for C64U devices", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "C64U",
        activeDeviceId: "device-c64u",
      }),
    ).toMatchObject({
      effectiveMode: "CONSERVATIVE",
      resolvedPreset: "CONSERVATIVE",
      isProvisional: false,
      reason: "auto-c64u",
    });
  });

  it("resolves AUTO to BALANCED for U64-family devices", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "U64",
        activeDeviceId: "device-u64",
      }),
    ).toMatchObject({
      effectiveMode: "BALANCED",
      resolvedPreset: "BALANCED",
      isProvisional: false,
      reason: "auto-u64-family",
    });
  });

  it("marks AUTO as provisional when no verified product is available", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: null,
        activeDeviceId: "device-unknown",
      }),
    ).toMatchObject({
      effectiveMode: "BALANCED",
      resolvedPreset: "BALANCED",
      isProvisional: true,
      reason: "auto-no-verified-product",
    });
  });

  it("preserves explicit user-chosen presets", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("CONSERVATIVE", {
        activeProduct: "U64",
        activeDeviceId: "device-u64",
      }),
    ).toMatchObject({
      effectiveMode: "CONSERVATIVE",
      resolvedPreset: null,
      isProvisional: false,
      reason: "explicit-user-choice",
    });
  });

  it("loads conservative preset values when AUTO resolves against a selected C64U", async () => {
    const { safety, store } = await loadModules();
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.updateSavedDevice(initialDeviceId, {
      name: "Legacy C64U",
      host: "c64u",
      lastKnownProduct: "C64U",
      lastKnownHostname: "c64u",
      lastKnownUniqueId: "UID-C64U-PRIMARY",
    });

    safety.saveDeviceSafetyMode("AUTO");
    const config = safety.loadDeviceSafetyConfig();

    expect(config.mode).toBe("AUTO");
    expect(config.resolution).toMatchObject({
      effectiveMode: "CONSERVATIVE",
      resolvedPreset: "CONSERVATIVE",
      isProvisional: false,
    });
    expect(config).toMatchObject(CONSERVATIVE_EXPECTATIONS);
  });

  it("re-resolves AUTO after switching the selected saved device", async () => {
    const { safety, store, initialDeviceId } = await addSwitchableDevices();
    safety.saveDeviceSafetyMode("AUTO");

    store.selectSavedDevice(initialDeviceId);
    expect(safety.loadDeviceSafetyConfig()).toMatchObject({
      mode: "AUTO",
      resolution: expect.objectContaining({
        effectiveMode: "BALANCED",
        resolvedPreset: "BALANCED",
      }),
      ...BALANCED_EXPECTATIONS,
    });

    store.selectSavedDevice("device-c64u");
    expect(safety.loadDeviceSafetyConfig()).toMatchObject({
      mode: "AUTO",
      resolution: expect.objectContaining({
        effectiveMode: "CONSERVATIVE",
        resolvedPreset: "CONSERVATIVE",
      }),
      ...CONSERVATIVE_EXPECTATIONS,
    });
  });

  it("keeps explicit stored modes on existing installs", async () => {
    const { safety } = await loadModules();

    safety.saveDeviceSafetyMode("BALANCED");

    expect(safety.loadDeviceSafetyMode()).toBe("BALANCED");
    expect(safety.loadDeviceSafetyConfig()).toMatchObject({
      mode: "BALANCED",
      resolution: expect.objectContaining({
        effectiveMode: "BALANCED",
        resolvedPreset: null,
        isProvisional: false,
      }),
      ...BALANCED_EXPECTATIONS,
    });
  });

  it("defaults fresh installs to AUTO", async () => {
    const { safety } = await loadModules();

    expect(safety.loadDeviceSafetyMode()).toBe("AUTO");
    expect(safety.loadDeviceSafetyConfig()).toMatchObject({
      mode: "AUTO",
      resolution: expect.objectContaining({
        effectiveMode: "CONSERVATIVE",
        resolvedPreset: "CONSERVATIVE",
        isProvisional: false,
      }),
      ...CONSERVATIVE_EXPECTATIONS,
    });
  });

  it("returns safe defaults when localStorage is unavailable", async () => {
    const { safety } = await loadModules();
    vi.stubGlobal("localStorage", undefined);

    expect(safety.loadDeviceSafetyMode()).toBe("AUTO");
    expect(safety.loadDeviceSafetyConfig()).toMatchObject({
      mode: "AUTO",
      resolution: expect.objectContaining({
        effectiveMode: "CONSERVATIVE",
        resolvedPreset: "CONSERVATIVE",
        isProvisional: false,
      }),
      ...CONSERVATIVE_EXPECTATIONS,
    });
  });

  it("skips window listeners when window is unavailable", async () => {
    const { safety } = await loadModules();
    vi.stubGlobal("window", undefined);

    const unsubscribe = safety.subscribeDeviceSafetyUpdates(() => undefined);
    expect(typeof unsubscribe).toBe("function");

    expect(() => safety.saveDeviceSafetyMode("AUTO")).not.toThrow();
    unsubscribe();
  });
});
