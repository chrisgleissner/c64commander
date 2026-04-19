/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportSettingsSnapshot, importSettingsJson, SETTINGS_EXPORT_VERSION } from "@/lib/config/settingsTransfer";
import * as appSettings from "@/lib/config/appSettings";
import * as deviceSafetySettings from "@/lib/config/deviceSafetySettings";

const featureFlagManagerMocks = vi.hoisted(() => ({
  load: vi.fn(async () => undefined),
  getExplicitOverrides: vi.fn(() => ({ commoserve_enabled: true })),
  replaceOverrides: vi.fn(async () => undefined),
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadDebugLoggingEnabled: vi.fn(),
  loadConfigWriteIntervalMs: vi.fn(),
  loadAutomaticDemoModeEnabled: vi.fn(),
  loadStartupDiscoveryWindowMs: vi.fn(),
  loadBackgroundRediscoveryIntervalMs: vi.fn(),
  loadDiscoveryProbeTimeoutMs: vi.fn(),
  loadDiskAutostartMode: vi.fn(),
  loadVolumeSliderPreviewIntervalMs: vi.fn(),
  loadArchiveHostOverride: vi.fn(),
  loadArchiveClientIdOverride: vi.fn(),
  loadArchiveUserAgentOverride: vi.fn(),

  saveDebugLoggingEnabled: vi.fn(),
  saveConfigWriteIntervalMs: vi.fn(),
  saveAutomaticDemoModeEnabled: vi.fn(),
  saveStartupDiscoveryWindowMs: vi.fn(),
  saveBackgroundRediscoveryIntervalMs: vi.fn(),
  saveDiscoveryProbeTimeoutMs: vi.fn(),
  saveDiskAutostartMode: vi.fn(),
  saveVolumeSliderPreviewIntervalMs: vi.fn(),
  saveArchiveHostOverride: vi.fn(),
  saveArchiveClientIdOverride: vi.fn(),
  saveArchiveUserAgentOverride: vi.fn(),

  clampConfigWriteIntervalMs: (v: number) => v,
  clampStartupDiscoveryWindowMs: (v: number) => v,
  clampBackgroundRediscoveryIntervalMs: (v: number) => v,
  clampDiscoveryProbeTimeoutMs: (v: number) => v,
  clampVolumeSliderPreviewIntervalMs: (v: number) => v,
}));

vi.mock("@/lib/config/featureFlags", () => ({
  FEATURE_FLAG_IDS: ["hvsc_enabled", "commoserve_enabled", "lighting_studio_enabled"],
  featureFlagManager: featureFlagManagerMocks,
  isKnownFeatureFlagId: (value: string) =>
    ["hvsc_enabled", "commoserve_enabled", "lighting_studio_enabled"].includes(value),
}));

vi.mock("@/lib/config/deviceSafetySettings", () => ({
  loadDeviceSafetyConfig: vi.fn(),

  saveDeviceSafetyMode: vi.fn(),
  saveFtpMaxConcurrency: vi.fn(),
  saveInfoCacheMs: vi.fn(),
  saveConfigsCacheMs: vi.fn(),
  saveConfigsCooldownMs: vi.fn(),
  saveDrivesCooldownMs: vi.fn(),
  saveFtpListCooldownMs: vi.fn(),
  saveBackoffBaseMs: vi.fn(),
  saveBackoffMaxMs: vi.fn(),
  saveBackoffFactor: vi.fn(),
  saveCircuitBreakerThreshold: vi.fn(),
  saveCircuitBreakerCooldownMs: vi.fn(),
  saveDiscoveryProbeIntervalMs: vi.fn(),
  saveAllowUserOverrideCircuit: vi.fn(),
}));

describe("settingsTransfer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    featureFlagManagerMocks.load.mockResolvedValue(undefined);
    featureFlagManagerMocks.getExplicitOverrides.mockReturnValue({ commoserve_enabled: true });
    featureFlagManagerMocks.replaceOverrides.mockResolvedValue(undefined);
  });

  describe("exportSettingsSnapshot", () => {
    it("collects all settings and explicit feature overrides", async () => {
      vi.mocked(appSettings.loadDebugLoggingEnabled).mockReturnValue(true);
      vi.mocked(appSettings.loadVolumeSliderPreviewIntervalMs).mockReturnValue(250);
      vi.mocked(appSettings.loadArchiveHostOverride).mockReturnValue("");
      vi.mocked(appSettings.loadArchiveClientIdOverride).mockReturnValue("");
      vi.mocked(appSettings.loadArchiveUserAgentOverride).mockReturnValue("");
      vi.mocked(deviceSafetySettings.loadDeviceSafetyConfig).mockReturnValue({
        mode: "RELAXED",
        // other props... spread mock return
      } as any);

      const result = await exportSettingsSnapshot();
      expect(result.version).toBe(SETTINGS_EXPORT_VERSION);
      expect(result.appSettings.debugLoggingEnabled).toBe(true);
      expect(result.appSettings.volumeSliderPreviewIntervalMs).toBe(250);
      expect(result.featureFlags).toEqual({ commoserve_enabled: true });
      expect(result.deviceSafety.mode).toBe("RELAXED");
    });
  });

  describe("importSettingsJson", () => {
    const validPayload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: true,
        configWriteIntervalMs: 1000,
        automaticDemoModeEnabled: false,
        startupDiscoveryWindowMs: 5000,
        backgroundRediscoveryIntervalMs: 60000,
        discoveryProbeTimeoutMs: 2000,
        diskAutostartMode: "dma",
        volumeSliderPreviewIntervalMs: 200,
        archiveHostOverride: "",
        archiveClientIdOverride: "",
        archiveUserAgentOverride: "",
      },
      featureFlags: {},
      deviceSafety: {
        mode: "BALANCED",
        ftpMaxConcurrency: 2,
        infoCacheMs: 1000,
        configsCacheMs: 1000,
        configsCooldownMs: 100,
        drivesCooldownMs: 100,
        ftpListCooldownMs: 100,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        backoffFactor: 2,
        circuitBreakerThreshold: 5,
        circuitBreakerCooldownMs: 5000,
        discoveryProbeIntervalMs: 10000,
        allowUserOverrideCircuit: true,
      },
    };

    it("imports valid payload", async () => {
      const result = await importSettingsJson(JSON.stringify(validPayload));
      expect(result).toEqual({ ok: true });

      expect(appSettings.saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
      expect(appSettings.saveVolumeSliderPreviewIntervalMs).toHaveBeenCalledWith(200);
      expect(deviceSafetySettings.saveDeviceSafetyMode).toHaveBeenCalledWith("BALANCED");
      expect(featureFlagManagerMocks.replaceOverrides).toHaveBeenCalledWith({});
    });

    it("rejects invalid JSON", async () => {
      await expect(importSettingsJson("{ bad")).resolves.toEqual({
        ok: false,
        error: expect.stringMatching(/JSON/),
      });
    });

    it("rejects wrong version", async () => {
      const invalid = { ...validPayload, version: 999 };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "Unsupported settings export version.",
      });
    });

    it("validates appSettings structure", async () => {
      const invalid = {
        ...validPayload,
        appSettings: { ...validPayload.appSettings, badKey: 1 },
      };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "appSettings contains unknown or missing keys.",
      });
    });

    it("validates appSettings types", async () => {
      const invalid = {
        ...validPayload,
        appSettings: {
          ...validPayload.appSettings,
          debugLoggingEnabled: "true",
        },
      };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "debugLoggingEnabled must be boolean.",
      });
    });

    it("validates deviceSafety types", async () => {
      const invalid = {
        ...validPayload,
        deviceSafety: { ...validPayload.deviceSafety, mode: "EXTREME" },
      };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "deviceSafety.mode is invalid.",
      });
    });

    it("rejects non-object appSettings", async () => {
      await expect(importSettingsJson(JSON.stringify({ ...validPayload, appSettings: null }))).resolves.toEqual({
        ok: false,
        error: "appSettings must be an object.",
      });
      await expect(importSettingsJson(JSON.stringify({ ...validPayload, appSettings: "string" }))).resolves.toEqual({
        ok: false,
        error: "appSettings must be an object.",
      });
    });

    it("rejects non-object deviceSafety", async () => {
      await expect(importSettingsJson(JSON.stringify({ ...validPayload, deviceSafety: null }))).resolves.toEqual({
        ok: false,
        error: "deviceSafety must be an object.",
      });
    });

    it("validates each appSettings field individually", async () => {
      const fields: Array<[string, unknown, string]> = [
        ["configWriteIntervalMs", "string", "configWriteIntervalMs must be a number."],
        ["automaticDemoModeEnabled", "x", "automaticDemoModeEnabled must be boolean."],
        ["startupDiscoveryWindowMs", null, "startupDiscoveryWindowMs must be a number."],
        ["backgroundRediscoveryIntervalMs", "bad", "backgroundRediscoveryIntervalMs must be a number."],
        ["discoveryProbeTimeoutMs", "notanumber", "discoveryProbeTimeoutMs must be a number."],
        ["diskAutostartMode", "usb", "diskAutostartMode must be kernal or dma."],
        ["volumeSliderPreviewIntervalMs", "slow", "volumeSliderPreviewIntervalMs must be a number."],
        ["archiveHostOverride", 1, "archiveHostOverride must be a string."],
        ["archiveClientIdOverride", 1, "archiveClientIdOverride must be a string."],
        ["archiveUserAgentOverride", 1, "archiveUserAgentOverride must be a string."],
      ];
      for (const [field, value, expectedError] of fields) {
        const invalid = {
          ...validPayload,
          appSettings: { ...validPayload.appSettings, [field]: value },
        };
        await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
          ok: false,
          error: expectedError,
        });
      }
    });

    it("rejects deviceSafety with non-finite numeric values", async () => {
      const invalid = {
        ...validPayload,
        deviceSafety: {
          ...validPayload.deviceSafety,
          ftpMaxConcurrency: "bad",
        },
      };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "deviceSafety numeric values must be numbers.",
      });
    });

    it("rejects deviceSafety when allowUserOverrideCircuit is not boolean", async () => {
      const invalid = {
        ...validPayload,
        deviceSafety: {
          ...validPayload.deviceSafety,
          allowUserOverrideCircuit: "yes",
        },
      };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "allowUserOverrideCircuit must be boolean.",
      });
    });

    it("rejects deviceSafety with extra or missing keys", async () => {
      const invalid = {
        ...validPayload,
        deviceSafety: { ...validPayload.deviceSafety, unknownKey: 1 },
      };
      await expect(importSettingsJson(JSON.stringify(invalid))).resolves.toEqual({
        ok: false,
        error: "deviceSafety contains unknown or missing keys.",
      });
    });

    it("rejects non-object outer payload", async () => {
      await expect(importSettingsJson(JSON.stringify(null))).resolves.toEqual({
        ok: false,
        error: "Payload must be a JSON object.",
      });
      await expect(importSettingsJson(JSON.stringify(42))).resolves.toEqual({
        ok: false,
        error: "Payload must be a JSON object.",
      });
    });

    it("imports legacy payload with commoserveEnabled", async () => {
      const payload = {
        ...validPayload,
        version: 1,
        appSettings: {
          ...validPayload.appSettings,
          commoserveEnabled: true,
        },
      };
      const result = await importSettingsJson(JSON.stringify(payload));
      expect(result).toEqual({ ok: true });
      expect(featureFlagManagerMocks.replaceOverrides).toHaveBeenCalledWith({ commoserve_enabled: true });
    });

    it("uses empty feature overrides when version 2 payload omits all flag overrides", async () => {
      const result = await importSettingsJson(JSON.stringify(validPayload));
      expect(result).toEqual({ ok: true });
      expect(featureFlagManagerMocks.replaceOverrides).toHaveBeenCalledWith({});
    });

    it("rejects non-boolean commoserveEnabled in legacy payloads", async () => {
      const payload = {
        ...validPayload,
        version: 1,
        appSettings: {
          ...validPayload.appSettings,
          commoserveEnabled: 1,
        },
      };
      await expect(importSettingsJson(JSON.stringify(payload))).resolves.toEqual({
        ok: false,
        error: "commoserveEnabled must be boolean.",
      });
    });

    it("rejects non-boolean feature flag values", async () => {
      const payload = {
        ...validPayload,
        featureFlags: {
          hvsc_enabled: "yes",
        },
      };
      await expect(importSettingsJson(JSON.stringify(payload))).resolves.toEqual({
        ok: false,
        error: "featureFlags.hvsc_enabled must be boolean.",
      });
    });
  });
});
