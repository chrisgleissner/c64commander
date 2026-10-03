/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductFamilyCode } from "@/lib/savedDevices/store";

const activeDevice = vi.hoisted(() => ({
  product: null as ProductFamilyCode | null,
  firmware: null as string | null,
}));

vi.mock("@/lib/savedDevices/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/savedDevices/store")>("@/lib/savedDevices/store");
  return {
    ...actual,
    getSelectedSavedDevice: () => null,
    getSelectedSavedDeviceProductFamilySync: () => activeDevice.product,
    getSelectedSavedDeviceFirmwareSync: () => activeDevice.firmware,
  };
});

import {
  loadDeviceSafetyConfig,
  saveDeviceSafetyMode,
  saveRestMaxConcurrency,
} from "@/lib/config/deviceSafetySettings";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { exportSettingsJson, importSettingsJson } from "@/lib/config/settingsTransfer";

const useDevice = (product: ProductFamilyCode | null, firmware: string | null) => {
  activeDevice.product = product;
  activeDevice.firmware = firmware;
};

describe("settings import under Auto device safety", () => {
  beforeEach(async () => {
    localStorage.clear();
    useDevice(null, null);
    await featureFlagManager.load();
    await featureFlagManager.replaceOverrides({});
  });

  it("lets Auto still choose Conservative for C64U 1.1.0 after importing a file exported while Auto resolved Balanced", async () => {
    saveDeviceSafetyMode("AUTO");
    useDevice("U64E", "3.14e");
    const exported = await exportSettingsJson();
    expect(JSON.parse(exported).deviceSafety.restMaxConcurrency).toBe(2);

    localStorage.clear();
    expect((await importSettingsJson(exported)).ok).toBe(true);
    useDevice("C64U", "1.1.0");

    const config = loadDeviceSafetyConfig();
    expect(config.mode).toBe("AUTO");
    expect(config.resolution?.effectiveMode).toBe("CONSERVATIVE");
    expect(config.restMaxConcurrency).toBe(1);
    expect(config.ftpMaxConcurrency).toBe(1);
    expect(config.allowUserOverrideCircuit).toBe(false);
  });

  it("keeps a value the user overrode under Auto across export and import", async () => {
    saveDeviceSafetyMode("AUTO");
    saveRestMaxConcurrency(4);
    const exported = await exportSettingsJson();

    localStorage.clear();
    expect((await importSettingsJson(exported)).ok).toBe(true);
    useDevice("C64U", "1.1.0");

    expect(loadDeviceSafetyConfig().restMaxConcurrency).toBe(4);
  });

  it("removes an existing override when the imported file carries the mode's own value", async () => {
    saveDeviceSafetyMode("AUTO");
    useDevice("U64E", "3.14e");
    const exported = await exportSettingsJson();
    saveRestMaxConcurrency(3);

    expect((await importSettingsJson(exported)).ok).toBe(true);
    useDevice("C64U", "1.1.0");

    expect(loadDeviceSafetyConfig().restMaxConcurrency).toBe(1);
  });
});
