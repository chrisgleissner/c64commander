/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadArchiveClientIdOverride,
  loadArchiveHostOverride,
  loadArchiveUserAgentOverride,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadDiskAutostartMode,
  loadScreenOrientationMode,
  loadStartupDiscoveryWindowMs,
  loadVolumeSliderPreviewIntervalMs,
} from "@/lib/config/appSettings";
import { loadDeviceSafetyConfig, saveDeviceSafetyMode } from "@/lib/config/deviceSafetySettings";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { setDeveloperModeEnabled } from "@/lib/config/developerModeStore";
import { exportSettingsSnapshot, importSettingsJson, SETTINGS_EXPORT_VERSION } from "@/lib/config/settingsTransfer";

const buildImportPayload = (featureFlags: Record<string, boolean>) => ({
  version: SETTINGS_EXPORT_VERSION,
  appSettings: {
    debugLoggingEnabled: false,
    configWriteIntervalMs: 800,
    automaticDemoModeEnabled: false,
    startupDiscoveryWindowMs: 4200,
    backgroundRediscoveryIntervalMs: 7000,
    discoveryProbeTimeoutMs: 3200,
    diskAutostartMode: "dma",
    screenOrientationMode: "landscape",
    volumeSliderPreviewIntervalMs: 300,
    archiveHostOverride: "archive.local:3002",
    archiveClientIdOverride: "Custom",
    archiveUserAgentOverride: "Custom Agent",
  },
  featureFlags,
  deviceSafety: {
    mode: "TROUBLESHOOTING",
    restMaxConcurrency: 1,
    ftpMaxConcurrency: 1,
    infoCacheMs: 400,
    configsCacheMs: 800,
    configsCooldownMs: 400,
    drivesCooldownMs: 400,
    ftpListCooldownMs: 300,
    telnetConnectCooldownMs: 200,
    backoffBaseMs: 200,
    backoffMaxMs: 1200,
    backoffFactor: 1.4,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 1500,
    discoveryProbeIntervalMs: 500,
    allowUserOverrideCircuit: false,
  },
});

describe("settingsTransfer", () => {
  beforeEach(async () => {
    localStorage.clear();
    setDeveloperModeEnabled(false);
    await featureFlagManager.load();
    await featureFlagManager.replaceOverrides({});
  });

  it("exports a versioned, whitelisted payload", async () => {
    const snapshot = await exportSettingsSnapshot();
    expect(snapshot.version).toBe(SETTINGS_EXPORT_VERSION);
    expect(snapshot.appSettings).toHaveProperty("debugLoggingEnabled");
    expect(snapshot.appSettings).toHaveProperty("volumeSliderPreviewIntervalMs");
    expect(snapshot.appSettings).toHaveProperty("screenOrientationMode");
    expect(snapshot.appSettings).toHaveProperty("archiveHostOverride");
    expect(snapshot).toHaveProperty("featureFlags");
    expect(snapshot.deviceSafety).toHaveProperty("mode");
    expect(JSON.stringify(snapshot)).not.toMatch(/password/i);
  });

  it("rejects unknown keys on import", async () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: true,
        configWriteIntervalMs: 500,
        automaticDemoModeEnabled: true,
        startupDiscoveryWindowMs: 3000,
        backgroundRediscoveryIntervalMs: 5000,
        discoveryProbeTimeoutMs: 2500,
        diskAutostartMode: "kernal",
        screenOrientationMode: "portrait",
        volumeSliderPreviewIntervalMs: 200,
        archiveHostOverride: "",
        archiveClientIdOverride: "",
        archiveUserAgentOverride: "",
        extra: "nope",
      },
      featureFlags: {},
      deviceSafety: {
        mode: "BALANCED",
        restMaxConcurrency: 2,
        ftpMaxConcurrency: 1,
        infoCacheMs: 600,
        configsCacheMs: 1000,
        configsCooldownMs: 500,
        drivesCooldownMs: 500,
        ftpListCooldownMs: 300,
        telnetConnectCooldownMs: 300,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 4000,
        discoveryProbeIntervalMs: 700,
        allowUserOverrideCircuit: true,
      },
    };

    const result = await importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });

  it("imports settings and applies values", async () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: false,
        configWriteIntervalMs: 800,
        automaticDemoModeEnabled: false,
        startupDiscoveryWindowMs: 4200,
        backgroundRediscoveryIntervalMs: 7000,
        discoveryProbeTimeoutMs: 3200,
        diskAutostartMode: "dma",
        screenOrientationMode: "landscape",
        volumeSliderPreviewIntervalMs: 300,
        archiveHostOverride: "archive.local:3002",
        archiveClientIdOverride: "Custom",
        archiveUserAgentOverride: "Custom Agent",
      },
      featureFlags: {
        commoserve_enabled: false,
        hvsc_enabled: true,
      },
      deviceSafety: {
        mode: "TROUBLESHOOTING",
        restMaxConcurrency: 1,
        ftpMaxConcurrency: 1,
        infoCacheMs: 400,
        configsCacheMs: 800,
        configsCooldownMs: 400,
        drivesCooldownMs: 400,
        ftpListCooldownMs: 300,
        telnetConnectCooldownMs: 200,
        backoffBaseMs: 200,
        backoffMaxMs: 1200,
        backoffFactor: 1.4,
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 1500,
        discoveryProbeIntervalMs: 500,
        allowUserOverrideCircuit: false,
      },
    };

    const result = await importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(loadDebugLoggingEnabled()).toBe(false);
    expect(loadConfigWriteIntervalMs()).toBe(800);
    expect(loadAutomaticDemoModeEnabled()).toBe(false);
    expect(loadStartupDiscoveryWindowMs()).toBe(4200);
    expect(loadBackgroundRediscoveryIntervalMs()).toBe(7000);
    expect(loadDiscoveryProbeTimeoutMs()).toBe(3200);
    expect(loadDiskAutostartMode()).toBe("dma");
    expect(loadScreenOrientationMode()).toBe("landscape");
    expect(loadVolumeSliderPreviewIntervalMs()).toBe(300);
    expect(loadArchiveHostOverride()).toBe("archive.local:3002");
    expect(loadArchiveClientIdOverride()).toBe("Custom");
    expect(loadArchiveUserAgentOverride()).toBe("Custom Agent");

    const safety = loadDeviceSafetyConfig();
    expect(safety.mode).toBe("TROUBLESHOOTING");
    expect(safety.allowUserOverrideCircuit).toBe(false);

    const snapshot = await exportSettingsSnapshot();
    expect(snapshot.featureFlags).toEqual({
      commoserve_enabled: false,
    });
  });

  it("round-trips AUTO device safety mode through export and import", async () => {
    saveDeviceSafetyMode("AUTO");

    const snapshot = await exportSettingsSnapshot();
    expect(snapshot.deviceSafety.mode).toBe("AUTO");

    const result = await importSettingsJson(JSON.stringify(snapshot));
    expect(result.ok).toBe(true);
    expect(loadDeviceSafetyConfig().mode).toBe("AUTO");
  });

  it("rejects invalid JSON payloads", async () => {
    const result = await importSettingsJson("{bad json");
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported versions", async () => {
    const payload = {
      version: 999,
      appSettings: {},
      deviceSafety: {},
    };

    const result = await importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });

  it("rejects invalid disk autostart mode", async () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: true,
        configWriteIntervalMs: 500,
        automaticDemoModeEnabled: true,
        startupDiscoveryWindowMs: 3000,
        backgroundRediscoveryIntervalMs: 5000,
        discoveryProbeTimeoutMs: 2500,
        diskAutostartMode: "never",
        screenOrientationMode: "portrait",
        volumeSliderPreviewIntervalMs: 200,
        archiveHostOverride: "",
        archiveClientIdOverride: "",
        archiveUserAgentOverride: "",
      },
      featureFlags: {},
      deviceSafety: {
        mode: "BALANCED",
        restMaxConcurrency: 2,
        ftpMaxConcurrency: 1,
        infoCacheMs: 600,
        configsCacheMs: 1000,
        configsCooldownMs: 500,
        drivesCooldownMs: 500,
        ftpListCooldownMs: 300,
        telnetConnectCooldownMs: 300,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 4000,
        discoveryProbeIntervalMs: 700,
        allowUserOverrideCircuit: true,
      },
    };

    const result = await importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });

  it("rejects deviceSafety with non-finite numeric values", async () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: true,
        configWriteIntervalMs: 500,
        automaticDemoModeEnabled: true,
        startupDiscoveryWindowMs: 3000,
        backgroundRediscoveryIntervalMs: 5000,
        discoveryProbeTimeoutMs: 2500,
        diskAutostartMode: "kernal",
        screenOrientationMode: "portrait",
        volumeSliderPreviewIntervalMs: 200,
        archiveHostOverride: "",
        archiveClientIdOverride: "",
        archiveUserAgentOverride: "",
      },
      featureFlags: {},
      deviceSafety: {
        mode: "BALANCED",
        ftpMaxConcurrency: "bad",
        infoCacheMs: 600,
        configsCacheMs: 1000,
        configsCooldownMs: 500,
        drivesCooldownMs: 500,
        ftpListCooldownMs: 300,
        telnetConnectCooldownMs: 300,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 4000,
        discoveryProbeIntervalMs: 700,
        allowUserOverrideCircuit: true,
      },
    };

    const result = await importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });

  describe("developer-only feature-flag import gating (HARD11-001)", () => {
    it("drops hidden/developer-only flag overrides when developer mode is off", async () => {
      setDeveloperModeEnabled(false);
      const payload = buildImportPayload({
        home_telnet_reu_snapshot_enabled: true,
        background_execution_enabled: false,
        commoserve_enabled: false,
      });

      const result = await importSettingsJson(JSON.stringify(payload));
      expect(result.ok).toBe(true);

      const snapshot = await exportSettingsSnapshot();
      expect(snapshot.featureFlags).not.toHaveProperty("home_telnet_reu_snapshot_enabled");
      expect(snapshot.featureFlags).not.toHaveProperty("background_execution_enabled");
      // A standard user-toggleable flag in the same payload still applies.
      expect(snapshot.featureFlags).toEqual({ commoserve_enabled: false });
    });

    it("persists hidden/developer-only flag overrides when developer mode is on", async () => {
      setDeveloperModeEnabled(true);
      const payload = buildImportPayload({
        home_telnet_reu_snapshot_enabled: true,
        background_execution_enabled: false,
      });

      const result = await importSettingsJson(JSON.stringify(payload));
      expect(result.ok).toBe(true);

      const snapshot = await exportSettingsSnapshot();
      expect(snapshot.featureFlags).toEqual({
        home_telnet_reu_snapshot_enabled: true,
        background_execution_enabled: false,
      });
    });

    it("keeps applying standard user-toggleable flags regardless of developer mode", async () => {
      setDeveloperModeEnabled(false);
      const payload = buildImportPayload({ hvsc_enabled: false });

      const result = await importSettingsJson(JSON.stringify(payload));
      expect(result.ok).toBe(true);

      const snapshot = await exportSettingsSnapshot();
      expect(snapshot.featureFlags).toEqual({ hvsc_enabled: false });
    });
  });
});
