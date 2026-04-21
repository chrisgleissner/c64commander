/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  loadArchiveClientIdOverride,
  loadArchiveHostOverride,
  loadArchiveUserAgentOverride,
  clampBackgroundRediscoveryIntervalMs,
  clampConfigWriteIntervalMs,
  clampDiscoveryProbeTimeoutMs,
  clampStartupDiscoveryWindowMs,
  clampVolumeSliderPreviewIntervalMs,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadDiskAutostartMode,
  loadStartupDiscoveryWindowMs,
  loadVolumeSliderPreviewIntervalMs,
  saveAutomaticDemoModeEnabled,
  saveArchiveClientIdOverride,
  saveArchiveHostOverride,
  saveArchiveUserAgentOverride,
  saveBackgroundRediscoveryIntervalMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiscoveryProbeTimeoutMs,
  saveDiskAutostartMode,
  saveStartupDiscoveryWindowMs,
  saveVolumeSliderPreviewIntervalMs,
  type DiskAutostartMode,
} from "@/lib/config/appSettings";
import {
  FEATURE_FLAG_IDS,
  featureFlagManager,
  isKnownFeatureFlagId,
  type FeatureFlagId,
} from "@/lib/config/featureFlags";
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
  type DeviceSafetyMode,
} from "@/lib/config/deviceSafetySettings";

export const SETTINGS_EXPORT_VERSION = 2 as const;

type SettingsAppSettingsPayload = {
  debugLoggingEnabled: boolean;
  configWriteIntervalMs: number;
  automaticDemoModeEnabled: boolean;
  startupDiscoveryWindowMs: number;
  backgroundRediscoveryIntervalMs: number;
  discoveryProbeTimeoutMs: number;
  diskAutostartMode: DiskAutostartMode;
  volumeSliderPreviewIntervalMs: number;
  archiveHostOverride: string;
  archiveClientIdOverride: string;
  archiveUserAgentOverride: string;
};

type LegacySettingsAppSettingsPayload = SettingsAppSettingsPayload & {
  commoserveEnabled?: boolean;
};

export type SettingsExportPayload = {
  version: typeof SETTINGS_EXPORT_VERSION;
  appSettings: SettingsAppSettingsPayload;
  featureFlags: Partial<Record<FeatureFlagId, boolean>>;
  deviceSafety: {
    mode: DeviceSafetyMode;
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

type LegacySettingsExportPayload = {
  version: 1;
  appSettings: LegacySettingsAppSettingsPayload;
  deviceSafety: SettingsExportPayload["deviceSafety"];
};

// Keys that must be present in all settings payloads.
const REQUIRED_APP_SETTINGS_KEYS = [
  "debugLoggingEnabled",
  "configWriteIntervalMs",
  "automaticDemoModeEnabled",
  "startupDiscoveryWindowMs",
  "backgroundRediscoveryIntervalMs",
  "discoveryProbeTimeoutMs",
  "diskAutostartMode",
  "volumeSliderPreviewIntervalMs",
  "archiveHostOverride",
  "archiveClientIdOverride",
  "archiveUserAgentOverride",
] as const;

const LEGACY_OPTIONAL_APP_SETTINGS_KEYS = ["commoserveEnabled"] as const;

const DEVICE_SAFETY_KEYS = [
  "mode",
  "ftpMaxConcurrency",
  "infoCacheMs",
  "configsCacheMs",
  "configsCooldownMs",
  "drivesCooldownMs",
  "ftpListCooldownMs",
  "backoffBaseMs",
  "backoffMaxMs",
  "backoffFactor",
  "circuitBreakerThreshold",
  "circuitBreakerCooldownMs",
  "discoveryProbeIntervalMs",
  "allowUserOverrideCircuit",
] as const;

const LEGACY_DEVICE_SAFETY_OPTIONAL_KEYS = ["restMaxConcurrency"] as const;

const hasRequiredKeysAllowOptional = (
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
) => {
  const allAllowed = [...requiredKeys, ...optionalKeys];
  const valueKeys = Object.keys(value);
  return valueKeys.every((key) => allAllowed.includes(key)) && requiredKeys.every((key) => key in value);
};

const isDiskAutostartMode = (value: unknown): value is DiskAutostartMode => value === "kernal" || value === "dma";

const isDeviceSafetyMode = (value: unknown): value is DeviceSafetyMode =>
  value === "RELAXED" || value === "BALANCED" || value === "CONSERVATIVE" || value === "TROUBLESHOOTING";

export const exportSettingsSnapshot = async (): Promise<SettingsExportPayload> => {
  await featureFlagManager.load();
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
      volumeSliderPreviewIntervalMs: loadVolumeSliderPreviewIntervalMs(),
      archiveHostOverride: loadArchiveHostOverride(),
      archiveClientIdOverride: loadArchiveClientIdOverride(),
      archiveUserAgentOverride: loadArchiveUserAgentOverride(),
    },
    featureFlags: featureFlagManager.getExplicitOverrides(),
    deviceSafety: {
      mode: safety.mode,
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

export const exportSettingsJson = async () => JSON.stringify(await exportSettingsSnapshot(), null, 2);

const validateAppSettings = (value: unknown, optionalKeys: readonly string[] = []) => {
  if (!value || typeof value !== "object") return "appSettings must be an object.";
  const record = value as Record<string, unknown>;
  if (!hasRequiredKeysAllowOptional(record, REQUIRED_APP_SETTINGS_KEYS, optionalKeys))
    return "appSettings contains unknown or missing keys.";
  if (typeof record.debugLoggingEnabled !== "boolean") return "debugLoggingEnabled must be boolean.";
  if (!Number.isFinite(record.configWriteIntervalMs)) return "configWriteIntervalMs must be a number.";
  if (typeof record.automaticDemoModeEnabled !== "boolean") return "automaticDemoModeEnabled must be boolean.";
  if (!Number.isFinite(record.startupDiscoveryWindowMs)) return "startupDiscoveryWindowMs must be a number.";
  if (!Number.isFinite(record.backgroundRediscoveryIntervalMs))
    return "backgroundRediscoveryIntervalMs must be a number.";
  if (!Number.isFinite(record.discoveryProbeTimeoutMs)) return "discoveryProbeTimeoutMs must be a number.";
  if (!isDiskAutostartMode(record.diskAutostartMode)) return "diskAutostartMode must be kernal or dma.";
  if (!Number.isFinite(record.volumeSliderPreviewIntervalMs)) return "volumeSliderPreviewIntervalMs must be a number.";
  if (typeof record.archiveHostOverride !== "string") return "archiveHostOverride must be a string.";
  if (typeof record.archiveClientIdOverride !== "string") return "archiveClientIdOverride must be a string.";
  if (typeof record.archiveUserAgentOverride !== "string") return "archiveUserAgentOverride must be a string.";
  if ("commoserveEnabled" in record && typeof record.commoserveEnabled !== "boolean")
    return "commoserveEnabled must be boolean.";
  return null;
};

const sanitizeFeatureFlags = (value: unknown): Partial<Record<FeatureFlagId, boolean>> | { error: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "featureFlags must be an object." };
  }
  const record = value as Record<string, unknown>;
  const next: Partial<Record<FeatureFlagId, boolean>> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (!isKnownFeatureFlagId(key)) {
      continue;
    }
    if (typeof rawValue !== "boolean") {
      return { error: `featureFlags.${key} must be boolean.` };
    }
    next[key] = rawValue;
  }
  return next;
};

const validateDeviceSafety = (value: unknown) => {
  if (!value || typeof value !== "object") return "deviceSafety must be an object.";
  const record = value as Record<string, unknown>;
  const allowedKeys = [...DEVICE_SAFETY_KEYS, ...LEGACY_DEVICE_SAFETY_OPTIONAL_KEYS];
  const keysAreAllowed = Object.keys(record).every((key) => allowedKeys.includes(key as (typeof allowedKeys)[number]));
  const requiredKeysPresent = DEVICE_SAFETY_KEYS.every((key) => key in record);
  if (!keysAreAllowed || !requiredKeysPresent) return "deviceSafety contains unknown or missing keys.";
  if (!isDeviceSafetyMode(record.mode)) return "deviceSafety.mode is invalid.";
  const numericKeys = DEVICE_SAFETY_KEYS.filter((key) => key !== "mode" && key !== "allowUserOverrideCircuit");
  if (numericKeys.some((key) => !Number.isFinite(record[key] as number))) {
    return "deviceSafety numeric values must be numbers.";
  }
  if (typeof record.allowUserOverrideCircuit !== "boolean") return "allowUserOverrideCircuit must be boolean.";
  return null;
};

export const importSettingsJson = async (raw: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "Payload must be a JSON object." };
  const payload = parsed as Record<string, unknown>;
  if (!("version" in payload) || (payload.version !== 1 && payload.version !== SETTINGS_EXPORT_VERSION)) {
    return { ok: false, error: "Unsupported settings export version." };
  }
  const appSettings = payload.appSettings as Record<string, unknown> | undefined;
  const deviceSafety = payload.deviceSafety as Record<string, unknown> | undefined;
  const version = payload.version as 1 | typeof SETTINGS_EXPORT_VERSION;

  const appError = validateAppSettings(appSettings, version === 1 ? LEGACY_OPTIONAL_APP_SETTINGS_KEYS : []);
  if (appError) return { ok: false, error: appError };
  const safetyError = validateDeviceSafety(deviceSafety);
  if (safetyError) return { ok: false, error: safetyError };

  let importedFeatureFlags: Partial<Record<FeatureFlagId, boolean>> = {};
  if (version === SETTINGS_EXPORT_VERSION) {
    try {
      const sanitized = sanitizeFeatureFlags(payload.featureFlags);
      if ("error" in sanitized) {
        return { ok: false, error: sanitized.error };
      }
      importedFeatureFlags = sanitized;
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  const safeApp = appSettings as LegacySettingsAppSettingsPayload;
  const safeSafety = deviceSafety as SettingsExportPayload["deviceSafety"];

  if (version === 1 && typeof safeApp.commoserveEnabled === "boolean") {
    importedFeatureFlags.commoserve_enabled = safeApp.commoserveEnabled;
  }

  saveDebugLoggingEnabled(Boolean(safeApp.debugLoggingEnabled));
  saveConfigWriteIntervalMs(clampConfigWriteIntervalMs(safeApp.configWriteIntervalMs));
  saveAutomaticDemoModeEnabled(Boolean(safeApp.automaticDemoModeEnabled));
  saveStartupDiscoveryWindowMs(clampStartupDiscoveryWindowMs(safeApp.startupDiscoveryWindowMs));
  saveBackgroundRediscoveryIntervalMs(clampBackgroundRediscoveryIntervalMs(safeApp.backgroundRediscoveryIntervalMs));
  saveDiscoveryProbeTimeoutMs(clampDiscoveryProbeTimeoutMs(safeApp.discoveryProbeTimeoutMs));
  saveDiskAutostartMode(safeApp.diskAutostartMode);
  saveVolumeSliderPreviewIntervalMs(clampVolumeSliderPreviewIntervalMs(safeApp.volumeSliderPreviewIntervalMs));
  saveArchiveHostOverride(safeApp.archiveHostOverride);
  saveArchiveClientIdOverride(safeApp.archiveClientIdOverride);
  saveArchiveUserAgentOverride(safeApp.archiveUserAgentOverride);

  saveDeviceSafetyMode(safeSafety.mode);
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
  await featureFlagManager.load();
  await featureFlagManager.replaceOverrides(importedFeatureFlags);

  return { ok: true };
};
