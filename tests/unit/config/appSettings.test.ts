/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STREAM_AUDIO_ROUTE,
  loadStreamAudioRoute,
  saveStreamAudioRoute,
  DEFAULT_AUTO_DEMO_MODE_ENABLED,
  DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS,
  DEFAULT_CONFIG_WRITE_INTERVAL_MS,
  DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS,
  DEFAULT_DISK_AUTOSTART_MODE,
  DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS,
  DEFAULT_STARTUP_DISCOVERY_WINDOW_MS,
  DEFAULT_ENABLE_SWIPE_NAVIGATION,
  DEFAULT_SID_RADIO_ENABLED,
  DEFAULT_SID_RANKING_ENABLED,
  DEFAULT_PLAYBACK_ENGINE,
  DEFAULT_LOCAL_ENGINE_ENABLED,
  APP_SETTINGS_KEYS,
  loadPlaybackEngine,
  savePlaybackEngine,
  loadLocalEngineEnabled,
  saveLocalEngineEnabled,
  loadSidRadioEnabled,
  saveSidRadioEnabled,
  loadSidRankingEnabled,
  saveSidRankingEnabled,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  loadDiskAutostartMode,
  loadEnableSwipeNavigation,
  loadStartupDiscoveryWindowMs,
  loadVolumeSliderPreviewIntervalMs,
  loadVicPaletteId,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDiscoveryProbeTimeoutMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiskAutostartMode,
  saveEnableSwipeNavigation,
  saveStartupDiscoveryWindowMs,
  saveVolumeSliderPreviewIntervalMs,
  saveVicPaletteId,
} from "@/lib/config/appSettings";

const collectSettingEvents = () => {
  const events: Array<{ key: string; value: unknown }> = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as {
      key: string;
      value: unknown;
    };
    events.push(detail);
  };
  window.addEventListener("c64u-app-settings-updated", listener);
  return {
    events,
    dispose: () => window.removeEventListener("c64u-app-settings-updated", listener),
  };
};

describe("appSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads defaults when local storage is empty", () => {
    expect(loadDebugLoggingEnabled()).toBe(false);
    expect(loadConfigWriteIntervalMs()).toBe(DEFAULT_CONFIG_WRITE_INTERVAL_MS);
    expect(loadAutomaticDemoModeEnabled()).toBe(DEFAULT_AUTO_DEMO_MODE_ENABLED);
    expect(loadStartupDiscoveryWindowMs()).toBe(DEFAULT_STARTUP_DISCOVERY_WINDOW_MS);
    expect(loadBackgroundRediscoveryIntervalMs()).toBe(DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS);
    expect(loadDiscoveryProbeTimeoutMs()).toBe(DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS);
    expect(loadDiskAutostartMode()).toBe(DEFAULT_DISK_AUTOSTART_MODE);
    expect(loadVolumeSliderPreviewIntervalMs()).toBe(DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS);
    expect(loadEnableSwipeNavigation()).toBe(DEFAULT_ENABLE_SWIPE_NAVIGATION);
    expect(loadSidRadioEnabled()).toBe(DEFAULT_SID_RADIO_ENABLED);
    expect(DEFAULT_SID_RADIO_ENABLED).toBe(true); // GA: on by default
    expect(loadSidRankingEnabled()).toBe(DEFAULT_SID_RANKING_ENABLED);
    expect(DEFAULT_SID_RANKING_ENABLED).toBe(true);
    expect(loadPlaybackEngine()).toBe(DEFAULT_PLAYBACK_ENGINE);
    expect(DEFAULT_PLAYBACK_ENGINE).toBe("c64"); // spec §12.5: C64 by default (local is opt-in)
    expect(loadLocalEngineEnabled()).toBe(DEFAULT_LOCAL_ENGINE_ENABLED);
    expect(DEFAULT_LOCAL_ENGINE_ENABLED).toBe(true); // GA: the on-device engine choice is offered
    expect(loadVicPaletteId()).toBe("device");
  });

  it("persists the VIC palette preference and notifies mounted palette consumers", () => {
    const { events, dispose } = collectSettingEvents();
    saveVicPaletteId("monochrome");

    expect(loadVicPaletteId()).toBe("monochrome");
    expect(events).toContainEqual({ key: "c64u_vic_palette", value: "monochrome" });
    dispose();
  });

  it("persists the local-engine rollout gate and emits an event", () => {
    const { events, dispose } = collectSettingEvents();
    saveLocalEngineEnabled(true);
    expect(localStorage.getItem(APP_SETTINGS_KEYS.LOCAL_ENGINE_ENABLED_KEY)).toBe("1");
    expect(loadLocalEngineEnabled()).toBe(true);
    expect(events).toContainEqual({ key: APP_SETTINGS_KEYS.LOCAL_ENGINE_ENABLED_KEY, value: true });
    dispose();
  });

  it("persists the playback engine and rejects unknown values", () => {
    const { events, dispose } = collectSettingEvents();
    savePlaybackEngine("local");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.PLAYBACK_ENGINE_KEY)).toBe("local");
    expect(loadPlaybackEngine()).toBe("local");
    expect(events).toContainEqual({ key: APP_SETTINGS_KEYS.PLAYBACK_ENGINE_KEY, value: "local" });

    savePlaybackEngine("c64");
    expect(loadPlaybackEngine()).toBe("c64");

    // A garbage value falls back to the safe default rather than throwing.
    localStorage.setItem(APP_SETTINGS_KEYS.PLAYBACK_ENGINE_KEY, "bogus");
    expect(loadPlaybackEngine()).toBe("c64");
    dispose();
  });

  it("saves values and emits setting events", () => {
    const { events, dispose } = collectSettingEvents();

    saveDebugLoggingEnabled(true);
    saveConfigWriteIntervalMs(432);
    saveAutomaticDemoModeEnabled(false);
    saveStartupDiscoveryWindowMs(3499);
    saveBackgroundRediscoveryIntervalMs(800);
    saveDiscoveryProbeTimeoutMs(2780);
    saveDiskAutostartMode("dma");
    saveVolumeSliderPreviewIntervalMs(321);
    saveEnableSwipeNavigation(true);
    saveSidRadioEnabled(true);
    saveSidRankingEnabled(true);

    dispose();

    expect(localStorage.getItem(APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY)).toBe("1");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY)).toBe("400");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.AUTO_DEMO_MODE_KEY)).toBe("0");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY)).toBe("3500");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY)).toBe("1000");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.DISCOVERY_PROBE_TIMEOUT_MS_KEY)).toBe("2800");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY)).toBe("dma");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY)).toBe("321");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.ENABLE_SWIPE_NAVIGATION_KEY)).toBe("1");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.SID_RADIO_ENABLED_KEY)).toBe("1");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.SID_RANKING_ENABLED_KEY)).toBe("1");

    expect(events).toEqual(
      expect.arrayContaining([
        { key: APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY, value: true },
        { key: APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY, value: 400 },
        { key: APP_SETTINGS_KEYS.AUTO_DEMO_MODE_KEY, value: false },
        { key: APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY, value: 3500 },
        {
          key: APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY,
          value: 1000,
        },
        { key: APP_SETTINGS_KEYS.DISCOVERY_PROBE_TIMEOUT_MS_KEY, value: 2800 },
        { key: APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY, value: "dma" },
        { key: APP_SETTINGS_KEYS.VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, value: 321 },
        { key: APP_SETTINGS_KEYS.ENABLE_SWIPE_NAVIGATION_KEY, value: true },
      ]),
    );
  });

  it("normalizes disk autostart mode input", () => {
    localStorage.setItem(APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY, "invalid");
    expect(loadDiskAutostartMode()).toBe("kernal");

    saveDiskAutostartMode("kernal");
    expect(loadDiskAutostartMode()).toBe("kernal");
  });

  it("returns fallback when localStorage has a non-numeric value for a number setting (BRDA:60)", () => {
    localStorage.setItem(APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY, "not-a-number");
    expect(loadConfigWriteIntervalMs()).toBe(DEFAULT_CONFIG_WRITE_INTERVAL_MS);
  });

  it("persists the Live View audio route and defaults to dynamic (firmware wifi=true)", () => {
    expect(DEFAULT_STREAM_AUDIO_ROUTE).toBe("dynamic");
    expect(loadStreamAudioRoute()).toBe("dynamic");

    saveStreamAudioRoute("wifi");
    expect(loadStreamAudioRoute()).toBe("wifi");
    saveStreamAudioRoute("ethernet");
    expect(loadStreamAudioRoute()).toBe("ethernet");

    // An unknown persisted value falls back to the default.
    localStorage.setItem("c64u_stream_audio_route", "bogus");
    expect(loadStreamAudioRoute()).toBe("dynamic");
  });
});
