const DEBUG_LOGGING_KEY = 'c64u_debug_logging_enabled';
const CONFIG_WRITE_INTERVAL_KEY = 'c64u_config_write_min_interval_ms';

export const DEFAULT_CONFIG_WRITE_INTERVAL_MS = 500;

const clampInterval = (value: number) => {
  if (Number.isNaN(value)) return DEFAULT_CONFIG_WRITE_INTERVAL_MS;
  return Math.min(2000, Math.max(0, Math.round(value / 100) * 100));
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

export const APP_SETTINGS_KEYS = {
  DEBUG_LOGGING_KEY,
  CONFIG_WRITE_INTERVAL_KEY,
};
