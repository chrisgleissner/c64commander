import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as appSettings from "@/lib/config/appSettings";

describe("appSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("debugLogging", () => {
    it("defaults to false", () => {
      expect(appSettings.loadDebugLoggingEnabled()).toBe(false);
    });

    it("saves and loads true", () => {
      appSettings.saveDebugLoggingEnabled(true);
      expect(appSettings.loadDebugLoggingEnabled()).toBe(true);
      expect(localStorage.getItem("c64u_debug_logging_enabled")).toBe("1");
    });

    it("saves and loads false", () => {
      appSettings.saveDebugLoggingEnabled(false);
      expect(appSettings.loadDebugLoggingEnabled()).toBe(false);
      expect(localStorage.getItem("c64u_debug_logging_enabled")).toBe("0");
    });

    it("broadcasts change", () => {
      const spy = vi.spyOn(window, "dispatchEvent");
      appSettings.saveDebugLoggingEnabled(true);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "c64u-app-settings-updated" }));
    });
  });

  describe("configWriteIntervalMs", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadConfigWriteIntervalMs()).toBe(appSettings.DEFAULT_CONFIG_WRITE_INTERVAL_MS);
    });

    it("clamps values correctly", () => {
      expect(appSettings.clampConfigWriteIntervalMs(50)).toBe(100);
      expect(appSettings.clampConfigWriteIntervalMs(49)).toBe(0);
      expect(appSettings.clampConfigWriteIntervalMs(2300)).toBe(2000); // Max 2000
      expect(appSettings.clampConfigWriteIntervalMs(NaN)).toBe(200); // Default
    });

    it("saves and loads", () => {
      appSettings.saveConfigWriteIntervalMs(1234); // -> 1200
      expect(appSettings.loadConfigWriteIntervalMs()).toBe(1200);
    });
  });

  describe("automaticDemoMode", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadAutomaticDemoModeEnabled()).toBe(appSettings.DEFAULT_AUTO_DEMO_MODE_ENABLED);
    });
    it("saves and loads false", () => {
      appSettings.saveAutomaticDemoModeEnabled(false);
      expect(appSettings.loadAutomaticDemoModeEnabled()).toBe(false);
    });
    it('saves true and stores "1" (BRDA:93)', () => {
      appSettings.saveAutomaticDemoModeEnabled(true);
      expect(localStorage.getItem("c64u_automatic_demo_mode_enabled")).toBe("1");
    });
  });

  describe("startupDiscoveryWindowMs", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadStartupDiscoveryWindowMs()).toBe(appSettings.DEFAULT_STARTUP_DISCOVERY_WINDOW_MS);
    });
    it("clamps correctly", () => {
      // Min 500, Max 15000, Round 100
      expect(appSettings.clampStartupDiscoveryWindowMs(100)).toBe(500);
      expect(appSettings.clampStartupDiscoveryWindowMs(16000)).toBe(15000);
      expect(appSettings.clampStartupDiscoveryWindowMs(1234)).toBe(1200);
      expect(appSettings.clampStartupDiscoveryWindowMs(NaN)).toBe(appSettings.DEFAULT_STARTUP_DISCOVERY_WINDOW_MS);
    });
    it("saves and loads", () => {
      appSettings.saveStartupDiscoveryWindowMs(2000);
      expect(appSettings.loadStartupDiscoveryWindowMs()).toBe(2000);
    });
  });

  describe("backgroundRediscoveryIntervalMs", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadBackgroundRediscoveryIntervalMs()).toBe(
        appSettings.DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS,
      );
    });
    it("clamps correctly", () => {
      // Min 1000, Max 60000
      expect(appSettings.clampBackgroundRediscoveryIntervalMs(500)).toBe(1000);
      expect(appSettings.clampBackgroundRediscoveryIntervalMs(70000)).toBe(60000);
      expect(appSettings.clampBackgroundRediscoveryIntervalMs(NaN)).toBe(
        appSettings.DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS,
      );
    });
    it("saves and loads", () => {
      appSettings.saveBackgroundRediscoveryIntervalMs(5000);
      expect(appSettings.loadBackgroundRediscoveryIntervalMs()).toBe(5000);
    });
  });

  describe("discoveryProbeTimeoutMs", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadDiscoveryProbeTimeoutMs()).toBe(appSettings.DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS);
    });
    it("clamps correctly", () => {
      // Min 500, Max 10000
      expect(appSettings.clampDiscoveryProbeTimeoutMs(100)).toBe(500);
      expect(appSettings.clampDiscoveryProbeTimeoutMs(11000)).toBe(10000);
      expect(appSettings.clampDiscoveryProbeTimeoutMs(NaN)).toBe(appSettings.DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS);
    });
    it("saves and loads", () => {
      appSettings.saveDiscoveryProbeTimeoutMs(3000);
      expect(appSettings.loadDiscoveryProbeTimeoutMs()).toBe(3000);
    });
  });

  describe("diskAutostartMode", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadDiskAutostartMode()).toBe(appSettings.DEFAULT_DISK_AUTOSTART_MODE);
    });
    it("normalizes invalid values", () => {
      localStorage.setItem(appSettings.APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY, "invalid");
      expect(appSettings.loadDiskAutostartMode()).toBe("kernal");
    });
    it("loads dma", () => {
      localStorage.setItem(appSettings.APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY, "dma");
      expect(appSettings.loadDiskAutostartMode()).toBe("dma");
    });
    it("saves and loads", () => {
      appSettings.saveDiskAutostartMode("dma");
      expect(appSettings.loadDiskAutostartMode()).toBe("dma");
    });
  });

  describe("volumeSliderPreviewIntervalMs", () => {
    it("defaults correctly", () => {
      expect(appSettings.loadVolumeSliderPreviewIntervalMs()).toBe(
        appSettings.DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS,
      );
    });

    it("clamps and saves correctly", () => {
      expect(appSettings.clampVolumeSliderPreviewIntervalMs(50)).toBe(100);
      expect(appSettings.clampVolumeSliderPreviewIntervalMs(999)).toBe(500);
      expect(appSettings.clampVolumeSliderPreviewIntervalMs(NaN)).toBe(
        appSettings.DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS,
      );

      appSettings.saveVolumeSliderPreviewIntervalMs(345);
      expect(appSettings.loadVolumeSliderPreviewIntervalMs()).toBe(345);
    });
  });

  describe("archive client settings", () => {
    it("saves and loads archive override strings", () => {
      appSettings.saveArchiveHostOverride("archive.local");
      appSettings.saveArchiveClientIdOverride("Custom Client");
      appSettings.saveArchiveUserAgentOverride("Custom Agent");

      expect(appSettings.loadArchiveHostOverride()).toBe("archive.local");
      expect(appSettings.loadArchiveClientIdOverride()).toBe("Custom Client");
      expect(appSettings.loadArchiveUserAgentOverride()).toBe("Custom Agent");
    });
  });

  describe("swipeNavigation", () => {
    it("defaults to disabled", () => {
      expect(appSettings.loadEnableSwipeNavigation()).toBe(appSettings.DEFAULT_ENABLE_SWIPE_NAVIGATION);
    });

    it("saves and loads enablement", () => {
      appSettings.saveEnableSwipeNavigation(true);
      expect(appSettings.loadEnableSwipeNavigation()).toBe(true);

      appSettings.saveEnableSwipeNavigation(false);
      expect(appSettings.loadEnableSwipeNavigation()).toBe(false);
    });
  });

  // Edge case: localStorage undefined
  describe("environment without localStorage", () => {
    let originalLocalStorage: any;
    beforeEach(() => {
      originalLocalStorage = global.localStorage;
      // @ts-expect-error - intentionally deleting global for test
      delete global.localStorage;
    });
    afterEach(() => {
      global.localStorage = originalLocalStorage;
    });

    it("handles missing localStorage gracefully", () => {
      expect(appSettings.loadDebugLoggingEnabled()).toBe(false);
      expect(() => appSettings.saveDebugLoggingEnabled(true)).not.toThrow();

      expect(() => appSettings.saveConfigWriteIntervalMs(100)).not.toThrow();
      expect(() => appSettings.saveAutomaticDemoModeEnabled(true)).not.toThrow();
      expect(() => appSettings.saveStartupDiscoveryWindowMs(1000)).not.toThrow();
      expect(() => appSettings.saveBackgroundRediscoveryIntervalMs(1000)).not.toThrow();
      expect(() => appSettings.saveDiscoveryProbeTimeoutMs(1000)).not.toThrow();
      expect(() => appSettings.saveDiskAutostartMode("dma")).not.toThrow();
      expect(() => appSettings.saveVolumeSliderPreviewIntervalMs(250)).not.toThrow();
      expect(() => appSettings.saveEnableSwipeNavigation(true)).not.toThrow();
      expect(() => appSettings.saveArchiveHostOverride("archive.local")).not.toThrow();
      expect(() => appSettings.saveArchiveClientIdOverride("Custom Client")).not.toThrow();
      expect(() => appSettings.saveArchiveUserAgentOverride("Custom Agent")).not.toThrow();
      // Covers BRDA:137 — loadDiskAutostartMode early-returns DEFAULT when localStorage absent
      expect(appSettings.loadDiskAutostartMode()).toBe(appSettings.DEFAULT_DISK_AUTOSTART_MODE);
      expect(appSettings.loadVolumeSliderPreviewIntervalMs()).toBe(
        appSettings.DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS,
      );
      expect(appSettings.loadArchiveHostOverride()).toBe("");
      expect(appSettings.loadArchiveClientIdOverride()).toBe("");
      expect(appSettings.loadArchiveUserAgentOverride()).toBe("");
      expect(appSettings.loadEnableSwipeNavigation()).toBe(appSettings.DEFAULT_ENABLE_SWIPE_NAVIGATION);
    });

    it("handles numeric reads without storage", () => {
      expect(appSettings.loadConfigWriteIntervalMs()).toBe(appSettings.DEFAULT_CONFIG_WRITE_INTERVAL_MS);
    });
  });
});
