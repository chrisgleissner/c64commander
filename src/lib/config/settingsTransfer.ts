/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  clampBackgroundRediscoveryIntervalMs,
  clampConfigWriteIntervalMs,
  clampDiscoveryProbeTimeoutMs,
  clampStartupDiscoveryWindowMs,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadDiskAutostartMode,
  loadStartupDiscoveryWindowMs,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiscoveryProbeTimeoutMs,
  saveDiskAutostartMode,
  saveStartupDiscoveryWindowMs,
  type DiskAutostartMode,
} from '@/lib/config/appSettings';
import {
  loadDeviceSafetyConfig,
  saveAllowUserOverrideCircuit,
  saveBackoffBaseMs,
  saveBackoffFactor,
  saveBackoffMaxMs,
  saveCircuitBreakerCooldownMs,
  saveCircuitBreakerThreshold,
  saveConfigsCacheMs,
  saveConfigsCooldownMs,
  saveDeviceSafetyMode,
  saveDiscoveryProbeIntervalMs,
  saveDrivesCooldownMs,
  saveFtpListCooldownMs,
  saveFtpMaxConcurrency,
  saveInfoCacheMs,
  saveRestMaxConcurrency,
  type DeviceSafetyMode,
} from '@/lib/config/deviceSafetySettings';

export const SETTINGS_EXPORT_VERSION = 1 as const;

export type SettingsExportPayload = {
  version: typeof SETTINGS_EXPORT_VERSION;
  appSettings: {
    debugLoggingEnabled: boolean;
    configWriteIntervalMs: number;
    automaticDemoModeEnabled: boolean;
    startupDiscoveryWindowMs: number;
    backgroundRediscoveryIntervalMs: number;
    discoveryProbeTimeoutMs: number;
    diskAutostartMode: DiskAutostartMode;
  };
  deviceSafety: {
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
};

const APP_SETTINGS_KEYS = [
  'debugLoggingEnabled',
  'configWriteIntervalMs',
  'automaticDemoModeEnabled',
  'startupDiscoveryWindowMs',
  'backgroundRediscoveryIntervalMs',
  'discoveryProbeTimeoutMs',
  'diskAutostartMode',
] as const;

const DEVICE_SAFETY_KEYS = [
  'mode',
  'restMaxConcurrency',
  'ftpMaxConcurrency',
  'infoCacheMs',
  'configsCacheMs',
  'configsCooldownMs',
  'drivesCooldownMs',
  'ftpListCooldownMs',
  'backoffBaseMs',
  'backoffMaxMs',
  'backoffFactor',
  'circuitBreakerThreshold',
  'circuitBreakerCooldownMs',
  'discoveryProbeIntervalMs',
  'allowUserOverrideCircuit',
] as const;

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const valueKeys = Object.keys(value);
  return valueKeys.every((key) => keys.includes(key)) && keys.every((key) => key in value);
};

const isDiskAutostartMode = (value: unknown): value is DiskAutostartMode =>
  value === 'kernal' || value === 'dma';

const isDeviceSafetyMode = (value: unknown): value is DeviceSafetyMode =>
  value === 'RELAXED' || value === 'BALANCED' || value === 'CONSERVATIVE' || value === 'TROUBLESHOOTING';

export const exportSettingsSnapshot = (): SettingsExportPayload => {
  const safety = loadDeviceSafetyConfig();
  return {
    version: SETTINGS_EXPORT_VERSION,
    appSettings: {
      debugLoggingEnabled: loadDebugLoggingEnabled(),
      configWriteIntervalMs: loadConfigWriteIntervalMs(),
      automaticDemoModeEnabled: loadAutomaticDemoModeEnabled(),
      startupDiscoveryWindowMs: loadStartupDiscoveryWindowMs(),
      backgroundRediscoveryIntervalMs: loadBackgroundRediscoveryIntervalMs(),
      discoveryProbeTimeoutMs: loadDiscoveryProbeTimeoutMs(),
      diskAutostartMode: loadDiskAutostartMode(),
    },
    deviceSafety: {
      mode: safety.mode,
      restMaxConcurrency: safety.restMaxConcurrency,
      ftpMaxConcurrency: safety.ftpMaxConcurrency,
      infoCacheMs: safety.infoCacheMs,
      configsCacheMs: safety.configsCacheMs,
      configsCooldownMs: safety.configsCooldownMs,
      drivesCooldownMs: safety.drivesCooldownMs,
      ftpListCooldownMs: safety.ftpListCooldownMs,
      backoffBaseMs: safety.backoffBaseMs,
      backoffMaxMs: safety.backoffMaxMs,
      backoffFactor: safety.backoffFactor,
      circuitBreakerThreshold: safety.circuitBreakerThreshold,
      circuitBreakerCooldownMs: safety.circuitBreakerCooldownMs,
      discoveryProbeIntervalMs: safety.discoveryProbeIntervalMs,
      allowUserOverrideCircuit: safety.allowUserOverrideCircuit,
    },
  };
};

export const exportSettingsJson = () => JSON.stringify(exportSettingsSnapshot(), null, 2);

const validateAppSettings = (value: unknown) => {
  if (!value || typeof value !== 'object') return 'appSettings must be an object.';
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, APP_SETTINGS_KEYS)) return 'appSettings contains unknown or missing keys.';
  if (typeof record.debugLoggingEnabled !== 'boolean') return 'debugLoggingEnabled must be boolean.';
  if (!Number.isFinite(record.configWriteIntervalMs)) return 'configWriteIntervalMs must be a number.';
  if (typeof record.automaticDemoModeEnabled !== 'boolean') return 'automaticDemoModeEnabled must be boolean.';
  if (!Number.isFinite(record.startupDiscoveryWindowMs)) return 'startupDiscoveryWindowMs must be a number.';
  if (!Number.isFinite(record.backgroundRediscoveryIntervalMs)) return 'backgroundRediscoveryIntervalMs must be a number.';
  if (!Number.isFinite(record.discoveryProbeTimeoutMs)) return 'discoveryProbeTimeoutMs must be a number.';
  if (!isDiskAutostartMode(record.diskAutostartMode)) return 'diskAutostartMode must be kernal or dma.';
  return null;
};

const validateDeviceSafety = (value: unknown) => {
  if (!value || typeof value !== 'object') return 'deviceSafety must be an object.';
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, DEVICE_SAFETY_KEYS)) return 'deviceSafety contains unknown or missing keys.';
  if (!isDeviceSafetyMode(record.mode)) return 'deviceSafety.mode is invalid.';
  const numericKeys = DEVICE_SAFETY_KEYS.filter((key) => key !== 'mode' && key !== 'allowUserOverrideCircuit');
  if (numericKeys.some((key) => !Number.isFinite(record[key] as number))) {
    return 'deviceSafety numeric values must be numbers.';
  }
  if (typeof record.allowUserOverrideCircuit !== 'boolean') return 'allowUserOverrideCircuit must be boolean.';
  return null;
};

export const importSettingsJson = (raw: string): { ok: true } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Payload must be a JSON object.' };
  const payload = parsed as Record<string, unknown>;
  if (!('version' in payload) || payload.version !== SETTINGS_EXPORT_VERSION) {
    return { ok: false, error: 'Unsupported settings export version.' };
  }
  const appSettings = payload.appSettings as Record<string, unknown> | undefined;
  const deviceSafety = payload.deviceSafety as Record<string, unknown> | undefined;

  const appError = validateAppSettings(appSettings);
  if (appError) return { ok: false, error: appError };
  const safetyError = validateDeviceSafety(deviceSafety);
  if (safetyError) return { ok: false, error: safetyError };

  const safeApp = appSettings as SettingsExportPayload['appSettings'];
  const safeSafety = deviceSafety as SettingsExportPayload['deviceSafety'];

  saveDebugLoggingEnabled(Boolean(safeApp.debugLoggingEnabled));
  saveConfigWriteIntervalMs(clampConfigWriteIntervalMs(safeApp.configWriteIntervalMs));
  saveAutomaticDemoModeEnabled(Boolean(safeApp.automaticDemoModeEnabled));
  saveStartupDiscoveryWindowMs(clampStartupDiscoveryWindowMs(safeApp.startupDiscoveryWindowMs));
  saveBackgroundRediscoveryIntervalMs(clampBackgroundRediscoveryIntervalMs(safeApp.backgroundRediscoveryIntervalMs));
  saveDiscoveryProbeTimeoutMs(clampDiscoveryProbeTimeoutMs(safeApp.discoveryProbeTimeoutMs));
  saveDiskAutostartMode(safeApp.diskAutostartMode);

  saveDeviceSafetyMode(safeSafety.mode);
  saveRestMaxConcurrency(safeSafety.restMaxConcurrency);
  saveFtpMaxConcurrency(safeSafety.ftpMaxConcurrency);
  saveInfoCacheMs(safeSafety.infoCacheMs);
  saveConfigsCacheMs(safeSafety.configsCacheMs);
  saveConfigsCooldownMs(safeSafety.configsCooldownMs);
  saveDrivesCooldownMs(safeSafety.drivesCooldownMs);
  saveFtpListCooldownMs(safeSafety.ftpListCooldownMs);
  saveBackoffBaseMs(safeSafety.backoffBaseMs);
  saveBackoffMaxMs(safeSafety.backoffMaxMs);
  saveBackoffFactor(safeSafety.backoffFactor);
  saveCircuitBreakerThreshold(safeSafety.circuitBreakerThreshold);
  saveCircuitBreakerCooldownMs(safeSafety.circuitBreakerCooldownMs);
  saveDiscoveryProbeIntervalMs(safeSafety.discoveryProbeIntervalMs);
  saveAllowUserOverrideCircuit(Boolean(safeSafety.allowUserOverrideCircuit));

  return { ok: true };
};
