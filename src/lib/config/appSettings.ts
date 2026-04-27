/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const DEBUG_LOGGING_KEY = "c64u_debug_logging_enabled";
const CONFIG_WRITE_INTERVAL_KEY = "c64u_config_write_min_interval_ms";
const DEMO_MODE_ENABLED_KEY = "c64u_demo_mode_enabled";
const LEGACY_AUTO_DEMO_MODE_KEY = "c64u_automatic_demo_mode_enabled";
const STARTUP_DISCOVERY_WINDOW_MS_KEY = "c64u_startup_discovery_window_ms";
const BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY = "c64u_background_rediscovery_interval_ms";
const DISCOVERY_PROBE_TIMEOUT_MS_KEY = "c64u_discovery_probe_timeout_ms";
const DISK_AUTOSTART_MODE_KEY = "c64u_disk_autostart_mode";
const VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY = "c64u_volume_slider_preview_interval_ms";
const NOTIFICATION_VISIBILITY_KEY = "c64u_notification_visibility";
const NOTIFICATION_DURATION_MS_KEY = "c64u_notification_duration_ms";
const AUTO_ROTATION_ENABLED_KEY = "c64u_auto_rotation_enabled";
const ENABLE_SWIPE_NAVIGATION_KEY = "c64u_enable_swipe_navigation";
const ARCHIVE_HOST_OVERRIDE_KEY = "c64u_archive_host_override";
const ARCHIVE_CLIENT_ID_OVERRIDE_KEY = "c64u_archive_client_id_override";
const ARCHIVE_USER_AGENT_OVERRIDE_KEY = "c64u_archive_user_agent_override";

export const DEFAULT_CONFIG_WRITE_INTERVAL_MS = 200;
export type NotificationVisibility = "errors-only" | "all";
export const DEFAULT_NOTIFICATION_VISIBILITY: NotificationVisibility = "errors-only";
export const DEFAULT_NOTIFICATION_DURATION_MS = 4000;
export const NOTIFICATION_DURATION_MIN_MS = 2000;
export const NOTIFICATION_DURATION_MAX_MS = 8000;
export const DEFAULT_DEMO_MODE_ENABLED = false;
export const DEFAULT_AUTO_DEMO_MODE_ENABLED = DEFAULT_DEMO_MODE_ENABLED;
export const DEFAULT_STARTUP_DISCOVERY_WINDOW_MS = 3000;
export const DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS = 5000;
export const DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS = 2500;
export type DiskAutostartMode = "kernal" | "dma";
export const DEFAULT_DISK_AUTOSTART_MODE: DiskAutostartMode = "kernal";
export const DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS = 200;

const clampInterval = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_CONFIG_WRITE_INTERVAL_MS;
  return Math.min(2000, Math.max(0, Math.round(value / 100) * 100));
};

const clampDiscoveryWindowMs = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_STARTUP_DISCOVERY_WINDOW_MS;
  const rounded = Math.round(value / 100) * 100;
  return Math.min(15000, Math.max(500, rounded));
};

const clampBackgroundRediscoveryIntervalMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS;
  const rounded = Math.round(value / 100) * 100;
  return Math.min(60000, Math.max(1000, rounded));
};

const clampDiscoveryProbeTimeoutMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS;
  const rounded = Math.round(value / 100) * 100;
  return Math.min(10000, Math.max(500, rounded));
};

const clampVolumeSliderPreviewIntervalMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS;
  return Math.min(500, Math.max(100, Math.round(value)));
};

const clampNotificationDurationMsInternal = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_NOTIFICATION_DURATION_MS;
  return Math.min(NOTIFICATION_DURATION_MAX_MS, Math.max(NOTIFICATION_DURATION_MIN_MS, Math.round(value / 500) * 500));
};

const readBoolean = (key: string, fallback: boolean) => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
};

const readBooleanWithLegacy = (key: string, legacyKey: string, fallback: boolean) => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw !== null) return raw === "1";
  const legacyRaw = localStorage.getItem(legacyKey);
  if (legacyRaw !== null) return legacyRaw === "1";
  return fallback;
};

const readNumber = (key: string, fallback: number) => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeDiskAutostartMode = (value: unknown): DiskAutostartMode => (value === "dma" ? "dma" : "kernal");

const broadcast = (key: string, value: unknown) => {
  window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key, value } }));
};

export const loadDebugLoggingEnabled = () => readBoolean(DEBUG_LOGGING_KEY, false);

export const saveDebugLoggingEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEBUG_LOGGING_KEY, enabled ? "1" : "0");
  broadcast(DEBUG_LOGGING_KEY, enabled);
};

export const loadConfigWriteIntervalMs = () =>
  clampInterval(readNumber(CONFIG_WRITE_INTERVAL_KEY, DEFAULT_CONFIG_WRITE_INTERVAL_MS));

export const saveConfigWriteIntervalMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampInterval(value);
  localStorage.setItem(CONFIG_WRITE_INTERVAL_KEY, String(clamped));
  broadcast(CONFIG_WRITE_INTERVAL_KEY, clamped);
};

export const clampConfigWriteIntervalMs = (value: number) => clampInterval(value);

export const loadDemoModeEnabled = () =>
  readBooleanWithLegacy(DEMO_MODE_ENABLED_KEY, LEGACY_AUTO_DEMO_MODE_KEY, DEFAULT_DEMO_MODE_ENABLED);

export const saveDemoModeEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEMO_MODE_ENABLED_KEY, enabled ? "1" : "0");
  localStorage.removeItem(LEGACY_AUTO_DEMO_MODE_KEY);
  broadcast(DEMO_MODE_ENABLED_KEY, enabled);
};

export const loadAutomaticDemoModeEnabled = loadDemoModeEnabled;

export const saveAutomaticDemoModeEnabled = saveDemoModeEnabled;

export const loadStartupDiscoveryWindowMs = () =>
  clampDiscoveryWindowMs(readNumber(STARTUP_DISCOVERY_WINDOW_MS_KEY, DEFAULT_STARTUP_DISCOVERY_WINDOW_MS));

export const saveStartupDiscoveryWindowMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampDiscoveryWindowMs(value);
  localStorage.setItem(STARTUP_DISCOVERY_WINDOW_MS_KEY, String(clamped));
  broadcast(STARTUP_DISCOVERY_WINDOW_MS_KEY, clamped);
};

export const clampStartupDiscoveryWindowMs = (value: number) => clampDiscoveryWindowMs(value);

export const loadBackgroundRediscoveryIntervalMs = () =>
  clampBackgroundRediscoveryIntervalMsInternal(
    readNumber(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS),
  );

export const saveBackgroundRediscoveryIntervalMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampBackgroundRediscoveryIntervalMsInternal(value);
  localStorage.setItem(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, String(clamped));
  broadcast(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, clamped);
};

export const clampBackgroundRediscoveryIntervalMs = (value: number) =>
  clampBackgroundRediscoveryIntervalMsInternal(value);

export const loadDiscoveryProbeTimeoutMs = () =>
  clampDiscoveryProbeTimeoutMsInternal(readNumber(DISCOVERY_PROBE_TIMEOUT_MS_KEY, DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS));

export const saveDiscoveryProbeTimeoutMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampDiscoveryProbeTimeoutMsInternal(value);
  localStorage.setItem(DISCOVERY_PROBE_TIMEOUT_MS_KEY, String(clamped));
  broadcast(DISCOVERY_PROBE_TIMEOUT_MS_KEY, clamped);
};

export const clampDiscoveryProbeTimeoutMs = (value: number) => clampDiscoveryProbeTimeoutMsInternal(value);

export const loadDiskAutostartMode = () => {
  if (typeof localStorage === "undefined") return DEFAULT_DISK_AUTOSTART_MODE;
  const raw = localStorage.getItem(DISK_AUTOSTART_MODE_KEY);
  return normalizeDiskAutostartMode(raw ?? DEFAULT_DISK_AUTOSTART_MODE);
};

export const saveDiskAutostartMode = (mode: DiskAutostartMode) => {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeDiskAutostartMode(mode);
  localStorage.setItem(DISK_AUTOSTART_MODE_KEY, normalized);
  broadcast(DISK_AUTOSTART_MODE_KEY, normalized);
};

export const loadVolumeSliderPreviewIntervalMs = () =>
  clampVolumeSliderPreviewIntervalMsInternal(
    readNumber(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, DEFAULT_VOLUME_SLIDER_PREVIEW_INTERVAL_MS),
  );

export const saveVolumeSliderPreviewIntervalMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampVolumeSliderPreviewIntervalMsInternal(value);
  localStorage.setItem(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, String(clamped));
  broadcast(VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY, clamped);
};

export const clampVolumeSliderPreviewIntervalMs = (value: number) => clampVolumeSliderPreviewIntervalMsInternal(value);

export const loadNotificationVisibility = (): NotificationVisibility => {
  if (typeof localStorage === "undefined") return DEFAULT_NOTIFICATION_VISIBILITY;
  const raw = localStorage.getItem(NOTIFICATION_VISIBILITY_KEY);
  return raw === "all" ? "all" : DEFAULT_NOTIFICATION_VISIBILITY;
};

export const saveNotificationVisibility = (value: NotificationVisibility) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(NOTIFICATION_VISIBILITY_KEY, value);
  broadcast(NOTIFICATION_VISIBILITY_KEY, value);
};

export const loadNotificationDurationMs = () =>
  clampNotificationDurationMsInternal(readNumber(NOTIFICATION_DURATION_MS_KEY, DEFAULT_NOTIFICATION_DURATION_MS));

export const saveNotificationDurationMs = (value: number) => {
  if (typeof localStorage === "undefined") return;
  const clamped = clampNotificationDurationMsInternal(value);
  localStorage.setItem(NOTIFICATION_DURATION_MS_KEY, String(clamped));
  broadcast(NOTIFICATION_DURATION_MS_KEY, clamped);
};

export const clampNotificationDurationMs = (value: number) => clampNotificationDurationMsInternal(value);

export const DEFAULT_AUTO_ROTATION_ENABLED = false;
export const DEFAULT_ENABLE_SWIPE_NAVIGATION = false;
export const loadAutoRotationEnabled = () => readBoolean(AUTO_ROTATION_ENABLED_KEY, DEFAULT_AUTO_ROTATION_ENABLED);

export const saveAutoRotationEnabled = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTO_ROTATION_ENABLED_KEY, enabled ? "1" : "0");
  broadcast(AUTO_ROTATION_ENABLED_KEY, enabled);
};

export const loadEnableSwipeNavigation = () =>
  readBoolean(ENABLE_SWIPE_NAVIGATION_KEY, DEFAULT_ENABLE_SWIPE_NAVIGATION);

export const saveEnableSwipeNavigation = (enabled: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENABLE_SWIPE_NAVIGATION_KEY, enabled ? "1" : "0");
  broadcast(ENABLE_SWIPE_NAVIGATION_KEY, enabled);
};

const loadString = (key: string) => {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(key) ?? "";
};

const saveString = (key: string, value: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, value);
  broadcast(key, value);
};

export const loadArchiveHostOverride = () => loadString(ARCHIVE_HOST_OVERRIDE_KEY);

export const saveArchiveHostOverride = (value: string) => saveString(ARCHIVE_HOST_OVERRIDE_KEY, value);

export const loadArchiveClientIdOverride = () => loadString(ARCHIVE_CLIENT_ID_OVERRIDE_KEY);

export const saveArchiveClientIdOverride = (value: string) => saveString(ARCHIVE_CLIENT_ID_OVERRIDE_KEY, value);

export const loadArchiveUserAgentOverride = () => loadString(ARCHIVE_USER_AGENT_OVERRIDE_KEY);

export const saveArchiveUserAgentOverride = (value: string) => saveString(ARCHIVE_USER_AGENT_OVERRIDE_KEY, value);

export const APP_SETTINGS_KEYS = {
  DEBUG_LOGGING_KEY,
  CONFIG_WRITE_INTERVAL_KEY,
  DEMO_MODE_ENABLED_KEY,
  AUTO_DEMO_MODE_KEY: DEMO_MODE_ENABLED_KEY,
  STARTUP_DISCOVERY_WINDOW_MS_KEY,
  BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY,
  DISCOVERY_PROBE_TIMEOUT_MS_KEY,
  DISK_AUTOSTART_MODE_KEY,
  VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY,
  NOTIFICATION_VISIBILITY_KEY,
  NOTIFICATION_DURATION_MS_KEY,
  AUTO_ROTATION_ENABLED_KEY,
  ENABLE_SWIPE_NAVIGATION_KEY,
  ARCHIVE_HOST_OVERRIDE_KEY,
  ARCHIVE_CLIENT_ID_OVERRIDE_KEY,
  ARCHIVE_USER_AGENT_OVERRIDE_KEY,
};
