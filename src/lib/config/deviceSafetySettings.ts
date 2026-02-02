export type DeviceSafetyMode = 'RELAXED' | 'BALANCED' | 'CONSERVATIVE' | 'TROUBLESHOOTING';

export type DeviceSafetyConfig = {
  mode: DeviceSafetyMode;
  restMaxConcurrency: number;
  ftpMaxConcurrency: number;
  infoCacheMs: number;
  configsCacheMs: number;
  configsCooldownMs: number;
  drivesCooldownMs: number;
  ftpListCooldownMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  backoffFactor: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  discoveryProbeIntervalMs: number;
  allowUserOverrideCircuit: boolean;
};

const DEVICE_SAFETY_MODE_KEY = 'c64u_device_safety_mode';
const REST_MAX_CONCURRENCY_KEY = 'c64u_device_safety_rest_max_concurrency';
const FTP_MAX_CONCURRENCY_KEY = 'c64u_device_safety_ftp_max_concurrency';
const INFO_CACHE_MS_KEY = 'c64u_device_safety_info_cache_ms';
const CONFIGS_CACHE_MS_KEY = 'c64u_device_safety_configs_cache_ms';
const CONFIGS_COOLDOWN_MS_KEY = 'c64u_device_safety_configs_cooldown_ms';
const DRIVES_COOLDOWN_MS_KEY = 'c64u_device_safety_drives_cooldown_ms';
const FTP_LIST_COOLDOWN_MS_KEY = 'c64u_device_safety_ftp_list_cooldown_ms';
const BACKOFF_BASE_MS_KEY = 'c64u_device_safety_backoff_base_ms';
const BACKOFF_MAX_MS_KEY = 'c64u_device_safety_backoff_max_ms';
const BACKOFF_FACTOR_KEY = 'c64u_device_safety_backoff_factor';
const CIRCUIT_BREAKER_THRESHOLD_KEY = 'c64u_device_safety_circuit_breaker_threshold';
const CIRCUIT_BREAKER_COOLDOWN_MS_KEY = 'c64u_device_safety_circuit_breaker_cooldown_ms';
const DISCOVERY_PROBE_INTERVAL_MS_KEY = 'c64u_device_safety_discovery_probe_interval_ms';
const ALLOW_USER_OVERRIDE_CIRCUIT_KEY = 'c64u_device_safety_allow_user_override_circuit';

export const DEFAULT_DEVICE_SAFETY_MODE: DeviceSafetyMode = 'BALANCED';

const MODE_DEFAULTS: Record<DeviceSafetyMode, Omit<DeviceSafetyConfig, 'mode'>> = {
  RELAXED: {
    restMaxConcurrency: 2,
    ftpMaxConcurrency: 2,
    infoCacheMs: 200,
    configsCacheMs: 600,
    configsCooldownMs: 300,
    drivesCooldownMs: 300,
    ftpListCooldownMs: 200,
    backoffBaseMs: 150,
    backoffMaxMs: 1000,
    backoffFactor: 1.5,
    circuitBreakerThreshold: 6,
    circuitBreakerCooldownMs: 1500,
    discoveryProbeIntervalMs: 400,
    allowUserOverrideCircuit: true,
  },
  BALANCED: {
    restMaxConcurrency: 1,
    ftpMaxConcurrency: 1,
    infoCacheMs: 600,
    configsCacheMs: 1200,
    configsCooldownMs: 600,
    drivesCooldownMs: 600,
    ftpListCooldownMs: 400,
    backoffBaseMs: 300,
    backoffMaxMs: 3000,
    backoffFactor: 1.8,
    circuitBreakerThreshold: 4,
    circuitBreakerCooldownMs: 3000,
    discoveryProbeIntervalMs: 700,
    allowUserOverrideCircuit: true,
  },
  CONSERVATIVE: {
    restMaxConcurrency: 1,
    ftpMaxConcurrency: 1,
    infoCacheMs: 1200,
    configsCacheMs: 2000,
    configsCooldownMs: 1200,
    drivesCooldownMs: 1000,
    ftpListCooldownMs: 800,
    backoffBaseMs: 500,
    backoffMaxMs: 6000,
    backoffFactor: 2,
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMs: 6000,
    discoveryProbeIntervalMs: 1000,
    allowUserOverrideCircuit: false,
  },
  TROUBLESHOOTING: {
    restMaxConcurrency: 1,
    ftpMaxConcurrency: 1,
    infoCacheMs: 300,
    configsCacheMs: 600,
    configsCooldownMs: 300,
    drivesCooldownMs: 300,
    ftpListCooldownMs: 300,
    backoffBaseMs: 200,
    backoffMaxMs: 1200,
    backoffFactor: 1.4,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 1500,
    discoveryProbeIntervalMs: 500,
    allowUserOverrideCircuit: true,
  },
};

const readString = (key: string) => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(key);
  return raw ?? null;
};

const readNumber = (key: string) => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (key: string) => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  return raw === '1';
};

const clampNumber = (value: number, min: number, max: number, step = 1) => {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  return Math.round(clamped / step) * step;
};

const normalizeMode = (mode?: string | null): DeviceSafetyMode => {
  if (mode === 'RELAXED' || mode === 'CONSERVATIVE' || mode === 'TROUBLESHOOTING') return mode;
  return 'BALANCED';
};

const broadcast = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('c64u-device-safety-updated', { detail: { key, value } }));
};

export const subscribeDeviceSafetyUpdates = (listener: (detail: { key?: string; value?: unknown }) => void) => {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<{ key?: string; value?: unknown }>).detail ?? {});
  };
  window.addEventListener('c64u-device-safety-updated', handler as EventListener);
  return () => window.removeEventListener('c64u-device-safety-updated', handler as EventListener);
};

export const loadDeviceSafetyMode = (): DeviceSafetyMode => normalizeMode(readString(DEVICE_SAFETY_MODE_KEY));

export const saveDeviceSafetyMode = (mode: DeviceSafetyMode) => {
  if (typeof localStorage === 'undefined') return;
  const normalized = normalizeMode(mode);
  localStorage.setItem(DEVICE_SAFETY_MODE_KEY, normalized);
  broadcast(DEVICE_SAFETY_MODE_KEY, normalized);
};

export const resetDeviceSafetyOverrides = () => {
  if (typeof localStorage === 'undefined') return;
  [
    REST_MAX_CONCURRENCY_KEY,
    FTP_MAX_CONCURRENCY_KEY,
    INFO_CACHE_MS_KEY,
    CONFIGS_CACHE_MS_KEY,
    CONFIGS_COOLDOWN_MS_KEY,
    DRIVES_COOLDOWN_MS_KEY,
    FTP_LIST_COOLDOWN_MS_KEY,
    BACKOFF_BASE_MS_KEY,
    BACKOFF_MAX_MS_KEY,
    BACKOFF_FACTOR_KEY,
    CIRCUIT_BREAKER_THRESHOLD_KEY,
    CIRCUIT_BREAKER_COOLDOWN_MS_KEY,
    DISCOVERY_PROBE_INTERVAL_MS_KEY,
    ALLOW_USER_OVERRIDE_CIRCUIT_KEY,
  ].forEach((key) => localStorage.removeItem(key));
  broadcast('c64u-device-safety-reset', Date.now());
};

const resolveOverride = (key: string, fallback: number) => {
  const override = readNumber(key);
  return override === null ? fallback : override;
};

const resolveBooleanOverride = (key: string, fallback: boolean) => {
  const override = readBoolean(key);
  return override === null ? fallback : override;
};

export const loadDeviceSafetyConfig = (): DeviceSafetyConfig => {
  const mode = loadDeviceSafetyMode();
  const defaults = MODE_DEFAULTS[mode];
  return {
    mode,
    restMaxConcurrency: clampNumber(resolveOverride(REST_MAX_CONCURRENCY_KEY, defaults.restMaxConcurrency), 1, 4, 1),
    ftpMaxConcurrency: clampNumber(resolveOverride(FTP_MAX_CONCURRENCY_KEY, defaults.ftpMaxConcurrency), 1, 4, 1),
    infoCacheMs: clampNumber(resolveOverride(INFO_CACHE_MS_KEY, defaults.infoCacheMs), 0, 5000, 50),
    configsCacheMs: clampNumber(resolveOverride(CONFIGS_CACHE_MS_KEY, defaults.configsCacheMs), 0, 10000, 50),
    configsCooldownMs: clampNumber(resolveOverride(CONFIGS_COOLDOWN_MS_KEY, defaults.configsCooldownMs), 0, 10000, 50),
    drivesCooldownMs: clampNumber(resolveOverride(DRIVES_COOLDOWN_MS_KEY, defaults.drivesCooldownMs), 0, 10000, 50),
    ftpListCooldownMs: clampNumber(resolveOverride(FTP_LIST_COOLDOWN_MS_KEY, defaults.ftpListCooldownMs), 0, 10000, 50),
    backoffBaseMs: clampNumber(resolveOverride(BACKOFF_BASE_MS_KEY, defaults.backoffBaseMs), 0, 10000, 50),
    backoffMaxMs: clampNumber(resolveOverride(BACKOFF_MAX_MS_KEY, defaults.backoffMaxMs), 0, 20000, 50),
    backoffFactor: clampNumber(resolveOverride(BACKOFF_FACTOR_KEY, defaults.backoffFactor), 1, 3, 0.1),
    circuitBreakerThreshold: clampNumber(resolveOverride(CIRCUIT_BREAKER_THRESHOLD_KEY, defaults.circuitBreakerThreshold), 0, 10, 1),
    circuitBreakerCooldownMs: clampNumber(resolveOverride(CIRCUIT_BREAKER_COOLDOWN_MS_KEY, defaults.circuitBreakerCooldownMs), 0, 20000, 100),
    discoveryProbeIntervalMs: clampNumber(resolveOverride(DISCOVERY_PROBE_INTERVAL_MS_KEY, defaults.discoveryProbeIntervalMs), 200, 2000, 50),
    allowUserOverrideCircuit: resolveBooleanOverride(ALLOW_USER_OVERRIDE_CIRCUIT_KEY, defaults.allowUserOverrideCircuit),
  };
};

const saveNumberOverride = (key: string, value: number) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, String(value));
  broadcast(key, value);
};

const saveBooleanOverride = (key: string, value: boolean) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value ? '1' : '0');
  broadcast(key, value);
};

export const saveRestMaxConcurrency = (value: number) =>
  saveNumberOverride(REST_MAX_CONCURRENCY_KEY, clampNumber(value, 1, 4, 1));

export const saveFtpMaxConcurrency = (value: number) =>
  saveNumberOverride(FTP_MAX_CONCURRENCY_KEY, clampNumber(value, 1, 4, 1));

export const saveInfoCacheMs = (value: number) =>
  saveNumberOverride(INFO_CACHE_MS_KEY, clampNumber(value, 0, 5000, 50));

export const saveConfigsCacheMs = (value: number) =>
  saveNumberOverride(CONFIGS_CACHE_MS_KEY, clampNumber(value, 0, 10000, 50));

export const saveConfigsCooldownMs = (value: number) =>
  saveNumberOverride(CONFIGS_COOLDOWN_MS_KEY, clampNumber(value, 0, 10000, 50));

export const saveDrivesCooldownMs = (value: number) =>
  saveNumberOverride(DRIVES_COOLDOWN_MS_KEY, clampNumber(value, 0, 10000, 50));

export const saveFtpListCooldownMs = (value: number) =>
  saveNumberOverride(FTP_LIST_COOLDOWN_MS_KEY, clampNumber(value, 0, 10000, 50));

export const saveBackoffBaseMs = (value: number) =>
  saveNumberOverride(BACKOFF_BASE_MS_KEY, clampNumber(value, 0, 10000, 50));

export const saveBackoffMaxMs = (value: number) =>
  saveNumberOverride(BACKOFF_MAX_MS_KEY, clampNumber(value, 0, 20000, 50));

export const saveBackoffFactor = (value: number) =>
  saveNumberOverride(BACKOFF_FACTOR_KEY, clampNumber(value, 1, 3, 0.1));

export const saveCircuitBreakerThreshold = (value: number) =>
  saveNumberOverride(CIRCUIT_BREAKER_THRESHOLD_KEY, clampNumber(value, 0, 10, 1));

export const saveCircuitBreakerCooldownMs = (value: number) =>
  saveNumberOverride(CIRCUIT_BREAKER_COOLDOWN_MS_KEY, clampNumber(value, 0, 20000, 100));

export const saveDiscoveryProbeIntervalMs = (value: number) =>
  saveNumberOverride(DISCOVERY_PROBE_INTERVAL_MS_KEY, clampNumber(value, 200, 2000, 50));

export const saveAllowUserOverrideCircuit = (value: boolean) =>
  saveBooleanOverride(ALLOW_USER_OVERRIDE_CIRCUIT_KEY, value);

export const DEVICE_SAFETY_SETTING_KEYS = {
  DEVICE_SAFETY_MODE_KEY,
  REST_MAX_CONCURRENCY_KEY,
  FTP_MAX_CONCURRENCY_KEY,
  INFO_CACHE_MS_KEY,
  CONFIGS_CACHE_MS_KEY,
  CONFIGS_COOLDOWN_MS_KEY,
  DRIVES_COOLDOWN_MS_KEY,
  FTP_LIST_COOLDOWN_MS_KEY,
  BACKOFF_BASE_MS_KEY,
  BACKOFF_MAX_MS_KEY,
  BACKOFF_FACTOR_KEY,
  CIRCUIT_BREAKER_THRESHOLD_KEY,
  CIRCUIT_BREAKER_COOLDOWN_MS_KEY,
  DISCOVERY_PROBE_INTERVAL_MS_KEY,
  ALLOW_USER_OVERRIDE_CIRCUIT_KEY,
};

export const DEVICE_SAFETY_PRESETS = MODE_DEFAULTS;
