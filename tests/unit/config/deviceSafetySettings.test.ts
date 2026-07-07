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
  restMaxConcurrency: 2,
  infoCacheMs: 600,
  configsCacheMs: 1000,
  configsCooldownMs: 500,
  drivesCooldownMs: 500,
  ftpListCooldownMs: 300,
  telnetConnectCooldownMs: 300,
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
  restMaxConcurrency: 1,
  infoCacheMs: 1200,
  configsCacheMs: 2000,
  configsCooldownMs: 1200,
  drivesCooldownMs: 1000,
  ftpListCooldownMs: 800,
  telnetConnectCooldownMs: 800,
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
    lastKnownFirmware: "3.14e",
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
    lastKnownFirmware: "1.1.0",
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

  it("resolves AUTO to CONSERVATIVE for C64U on firmware up to 1.1.0 and the first 3.14e build", async () => {
    const { safety } = await loadModules();

    for (const firmware of ["1.1.0", "1.0.5", "3.14e"]) {
      expect(
        safety.resolveAutoSafetyMode("AUTO", {
          activeProduct: "C64U",
          activeDeviceId: "device-c64u",
          activeFirmware: firmware,
        }),
      ).toMatchObject({ effectiveMode: "CONSERVATIVE", resolvedPreset: "CONSERVATIVE", isProvisional: false });
    }
  });

  it("resolves AUTO to BALANCED for C64U on firmware after 1.1.0", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "C64U",
        activeDeviceId: "device-c64u",
        activeFirmware: "1.2.0",
      }),
    ).toMatchObject({ effectiveMode: "BALANCED", resolvedPreset: "BALANCED", reason: "auto-c64u-firmware-fixed" });
  });

  it("stays CONSERVATIVE (provisional) for a C64U whose firmware is not yet known", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "C64U",
        activeDeviceId: "device-c64u",
      }),
    ).toMatchObject({ effectiveMode: "CONSERVATIVE", isProvisional: true, reason: "auto-c64u-firmware-unknown" });
  });

  it("resolves AUTO to CONSERVATIVE for U2 (Ultimate II) devices (safety-first default)", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "U2",
        activeDeviceId: "device-u2",
      }),
    ).toMatchObject({
      effectiveMode: "CONSERVATIVE",
      resolvedPreset: "CONSERVATIVE",
      isProvisional: false,
      reason: "auto-u2",
    });
  });

  it("resolves AUTO to BALANCED for U64-family devices on firmware >= 3.14d", async () => {
    const { safety } = await loadModules();

    for (const [product, firmware] of [
      ["U64", "3.14e"],
      ["U64E", "3.14d"],
      ["U64E2", "3.15a"],
    ] as const) {
      expect(
        safety.resolveAutoSafetyMode("AUTO", {
          activeProduct: product,
          activeDeviceId: "device-u64",
          activeFirmware: firmware,
        }),
      ).toMatchObject({ effectiveMode: "BALANCED", resolvedPreset: "BALANCED", reason: "auto-u64-firmware-fixed" });
    }
  });

  it("resolves AUTO to CONSERVATIVE for U64-family devices on firmware older than 3.14d or unknown", async () => {
    const { safety } = await loadModules();

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "U64",
        activeDeviceId: "device-u64",
        activeFirmware: "3.14c",
      }),
    ).toMatchObject({ effectiveMode: "CONSERVATIVE", reason: "auto-u64-firmware-old" });

    expect(
      safety.resolveAutoSafetyMode("AUTO", {
        activeProduct: "U64E2",
        activeDeviceId: "device-u64",
      }),
    ).toMatchObject({ effectiveMode: "CONSERVATIVE", isProvisional: true, reason: "auto-u64-firmware-unknown" });
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
      lastKnownFirmware: "1.1.0",
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
        // Fresh install: product resolves to C64U but firmware is not yet known,
        // so we hold the safety-first CONSERVATIVE preset (provisional until /v1/info).
        effectiveMode: "CONSERVATIVE",
        resolvedPreset: "CONSERVATIVE",
        isProvisional: true,
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
        isProvisional: true,
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

  // Issue 3d: machine:input safety is now non-overlap serialization (always on,
  // regardless of mode - see machineInputThrottle), so the cooldown is an OPTIONAL
  // extra floor that defaults to 0 (zero added delay) in every mode.
  describe("machineInputCooldownMs", () => {
    it("defaults to 0 (non-overlap only, no added delay) under RELAXED", async () => {
      const { safety } = await loadModules();
      safety.saveDeviceSafetyMode("RELAXED");
      expect(safety.loadDeviceSafetyConfig().machineInputCooldownMs).toBe(0);
    });

    it("defaults to 0 under BALANCED (non-overlap serialization is the safety model)", async () => {
      const { safety } = await loadModules();
      safety.saveDeviceSafetyMode("BALANCED");
      expect(safety.loadDeviceSafetyConfig().machineInputCooldownMs).toBe(0);
    });

    it("defaults to 0 even under CONSERVATIVE - a serialized single-request stream cannot wedge the stack", async () => {
      const { safety } = await loadModules();
      safety.saveDeviceSafetyMode("CONSERVATIVE");
      const config = safety.loadDeviceSafetyConfig();
      expect(config.machineInputCooldownMs).toBe(0);
      expect(config.machineInputCooldownMs).toBeLessThan(config.configsCooldownMs);
    });

    it("persists and clamps a user override, and clears it on reset", async () => {
      const { safety } = await loadModules();
      safety.saveDeviceSafetyMode("BALANCED");

      safety.saveMachineInputCooldownMs(9999); // above the 2000ms clamp ceiling
      expect(safety.loadDeviceSafetyConfig().machineInputCooldownMs).toBe(2000);

      safety.saveMachineInputCooldownMs(-50); // below the 0ms floor
      expect(safety.loadDeviceSafetyConfig().machineInputCooldownMs).toBe(0);

      safety.saveMachineInputCooldownMs(150);
      expect(safety.loadDeviceSafetyConfig().machineInputCooldownMs).toBe(150);

      safety.resetDeviceSafetyOverrides();
      expect(safety.loadDeviceSafetyConfig().machineInputCooldownMs).toBe(0);
    });

    it("broadcasts a device-safety-updated event when the override changes", async () => {
      const { safety } = await loadModules();
      const listener = vi.fn();
      const unsubscribe = safety.subscribeDeviceSafetyUpdates(listener);

      safety.saveMachineInputCooldownMs(120);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ key: safety.DEVICE_SAFETY_SETTING_KEYS.MACHINE_INPUT_COOLDOWN_MS_KEY, value: 120 }),
      );
      unsubscribe();
    });
  });
});

// HARD18-013 (M2): the firmware/HIL gate that decides whether an interactive
// multi-item config write (Audio Mixer, lighting) may ride the tempfile-
// buffering POST /v1/configs handler instead of decomposing to sequential
// PUTs. isMultiItemConfigPostAllowed takes the HIL-validated flag as a plain
// argument specifically so this gate is testable independent of the
// hardcoded MULTI_ITEM_CONFIG_POST_HIL_VALIDATED module constant (which is
// false - see its own comment for the 2026-07-07 u64 fw 3.15 soak result).
describe("multiItemConfigPostAllowed / isMultiItemConfigPostAllowed (HARD18-013)", () => {
  it("is always false when the HIL-validated flag is off, regardless of firmware", async () => {
    const { safety } = await loadModules();
    expect(safety.isMultiItemConfigPostAllowed(false, "U64", "9.99")).toBe(false);
    expect(safety.isMultiItemConfigPostAllowed(false, "C64U", "9.99")).toBe(false);
  });

  it("requires firmware at/above the per-family line even when the flag is on", async () => {
    const { safety } = await loadModules();
    expect(safety.isMultiItemConfigPostAllowed(true, "U64", "3.14e")).toBe(false);
    expect(safety.isMultiItemConfigPostAllowed(true, "U64", "3.15")).toBe(true);
    expect(safety.isMultiItemConfigPostAllowed(true, "U64E", "3.15")).toBe(true);
    expect(safety.isMultiItemConfigPostAllowed(true, "U64E2", "3.15")).toBe(true);
    expect(safety.isMultiItemConfigPostAllowed(true, "C64U", "1.1.0")).toBe(false);
    expect(safety.isMultiItemConfigPostAllowed(true, "C64U", "1.2.0")).toBe(true);
  });

  it("is false for U2 and unknown products regardless of the flag", async () => {
    const { safety } = await loadModules();
    expect(safety.isMultiItemConfigPostAllowed(true, "U2", "9.99")).toBe(false);
    expect(safety.isMultiItemConfigPostAllowed(true, null, "9.99")).toBe(false);
  });

  it("the production flag (multiItemConfigPostAllowed) stays decomposed until re-soaked", async () => {
    const { safety } = await loadModules();
    expect(safety.MULTI_ITEM_CONFIG_POST_HIL_VALIDATED).toBe(false);
    expect(safety.multiItemConfigPostAllowed("U64", "3.15")).toBe(false);
    expect(safety.multiItemConfigPostAllowed("C64U", "1.2.0")).toBe(false);
  });
});
