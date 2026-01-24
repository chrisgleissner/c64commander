const DEBUG_LOGGING_KEY = 'c64u_debug_logging_enabled';
const CONFIG_WRITE_INTERVAL_KEY = 'c64u_config_write_min_interval_ms';
const AUTO_DEMO_MODE_KEY = 'c64u_automatic_demo_mode_enabled';
const STARTUP_DISCOVERY_WINDOW_MS_KEY = 'c64u_startup_discovery_window_ms';
const BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY = 'c64u_background_rediscovery_interval_ms';

export const DEFAULT_CONFIG_WRITE_INTERVAL_MS = 500;
export const DEFAULT_AUTO_DEMO_MODE_ENABLED = true;
export const DEFAULT_STARTUP_DISCOVERY_WINDOW_MS = 3000;
export const DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS = 5000;

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

const readBoolean = (key: string, fallback: boolean) => {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1';
};

const readNumber = (key: string, fallback: number) => {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const broadcast = (key: string, value: unknown) => {
  window.dispatchEvent(new CustomEvent('c64u-app-settings-updated', { detail: { key, value } }));
};

export const loadDebugLoggingEnabled = () => readBoolean(DEBUG_LOGGING_KEY, false);

export const saveDebugLoggingEnabled = (enabled: boolean) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DEBUG_LOGGING_KEY, enabled ? '1' : '0');
  broadcast(DEBUG_LOGGING_KEY, enabled);
};

export const loadConfigWriteIntervalMs = () =>
  clampInterval(readNumber(CONFIG_WRITE_INTERVAL_KEY, DEFAULT_CONFIG_WRITE_INTERVAL_MS));

export const saveConfigWriteIntervalMs = (value: number) => {
  if (typeof localStorage === 'undefined') return;
  const clamped = clampInterval(value);
  localStorage.setItem(CONFIG_WRITE_INTERVAL_KEY, String(clamped));
  broadcast(CONFIG_WRITE_INTERVAL_KEY, clamped);
};

export const clampConfigWriteIntervalMs = (value: number) => clampInterval(value);

export const loadAutomaticDemoModeEnabled = () =>
  readBoolean(AUTO_DEMO_MODE_KEY, DEFAULT_AUTO_DEMO_MODE_ENABLED);

export const saveAutomaticDemoModeEnabled = (enabled: boolean) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AUTO_DEMO_MODE_KEY, enabled ? '1' : '0');
  broadcast(AUTO_DEMO_MODE_KEY, enabled);
};

export const loadStartupDiscoveryWindowMs = () =>
  clampDiscoveryWindowMs(readNumber(STARTUP_DISCOVERY_WINDOW_MS_KEY, DEFAULT_STARTUP_DISCOVERY_WINDOW_MS));

export const saveStartupDiscoveryWindowMs = (value: number) => {
  if (typeof localStorage === 'undefined') return;
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
  if (typeof localStorage === 'undefined') return;
  const clamped = clampBackgroundRediscoveryIntervalMsInternal(value);
  localStorage.setItem(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, String(clamped));
  broadcast(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, clamped);
};

export const clampBackgroundRediscoveryIntervalMs = (value: number) =>
  clampBackgroundRediscoveryIntervalMsInternal(value);

export const APP_SETTINGS_KEYS = {
  DEBUG_LOGGING_KEY,
  CONFIG_WRITE_INTERVAL_KEY,
  AUTO_DEMO_MODE_KEY,
  STARTUP_DISCOVERY_WINDOW_MS_KEY,
  BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY,
};
