/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { addLog } from "@/lib/logging";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import { FEATURE_FLAG_DEFINITIONS, type FeatureFlagKey, type FeatureFlags } from "@/lib/config/featureFlags";
import {
  FEATURE_FLAG_DEFINITIONS,
  featureFlagManager,
  type FeatureFlagKey,
  type FeatureFlags,
} from "@/lib/config/featureFlags";
import { normalizeDeviceHost } from "@/lib/c64api";
import { FeatureFlags as FeatureFlagsPlugin } from "@/lib/native/featureFlags";

const SMOKE_CONFIG_STORAGE_KEY = "c64u_smoke_config";
const SMOKE_MODE_STORAGE_KEY = "c64u_smoke_mode_enabled";
const SMOKE_CONFIG_FILENAME = "c64u-smoke.json";
const SMOKE_STATUS_FILENAME = "c64u-smoke-status.json";

export type SmokeTarget = "mock" | "real";
export type SmokeFeatureFlags = Partial<FeatureFlags>;
export type SmokeConfig = {
  target: SmokeTarget;
  host?: string;
  readOnly?: boolean;
  debugLogging?: boolean;
  featureFlags?: SmokeFeatureFlags;
};

let cachedSmokeConfig: SmokeConfig | null = null;

type SmokeBootstrapWindow = Window & {
  __c64uReadSmokeConfigFromFilesystem?: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isFeatureFlagKey = (value: string): value is FeatureFlagKey => value in FEATURE_FLAG_DEFINITIONS;

const parseSmokeFeatureFlags = (raw: unknown): SmokeFeatureFlags | undefined => {
  if (!isObject(raw)) return undefined;
  const featureFlags: SmokeFeatureFlags = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!isFeatureFlagKey(key) || typeof value !== "boolean") return;
    featureFlags[key] = value;
  });
  return Object.keys(featureFlags).length > 0 ? featureFlags : undefined;
};

const parseSmokeConfig = (raw: unknown): SmokeConfig | null => {
  if (!isObject(raw)) return null;
  const target = raw.target === "real" ? "real" : raw.target === "mock" ? "mock" : null;
  if (!target) return null;
  const host = typeof raw.host === "string" && raw.host.trim().length > 0 ? normalizeDeviceHost(raw.host) : undefined;
  const readOnly = typeof raw.readOnly === "boolean" ? raw.readOnly : true;
  const debugLogging = typeof raw.debugLogging === "boolean" ? raw.debugLogging : true;
  const featureFlags = parseSmokeFeatureFlags(raw.featureFlags);
  return { target, host, readOnly, debugLogging, featureFlags };
};

const persistSmokeFeatureFlags = async (featureFlags: SmokeFeatureFlags | undefined) => {
  if (!featureFlags) return;
  for (const [key, value] of Object.entries(featureFlags) as Array<[FeatureFlagKey, boolean]>) {
    try {
      await FeatureFlagsPlugin.setFlag({ key, value });
    } catch (error) {
      addLog("warn", "Failed to apply smoke feature flag", {
        key,
        error: (error as Error).message,
      });
    }

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`c64u_feature_flag:${key}`, value ? "1" : "0");
      }
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(`c64u_feature_flag:${key}`, value ? "1" : "0");
      }
    } catch (error) {
      addLog("warn", "Failed to persist smoke feature flag in storage", {
        key,
        error: (error as Error).message,
      });
    }
  }

  await featureFlagManager.reload();
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
    if ("error" in error) {
      const nested = (error as { error?: unknown }).error;
      if (typeof nested === "string") return nested;
      if (
        nested &&
        typeof nested === "object" &&
        "message" in nested &&
        typeof (nested as { message?: unknown }).message === "string"
      ) {
        return (nested as { message: string }).message;
      }
    }
  }
  return String(error ?? "");
};

const isMissingFileError = (error: unknown) =>
  /does not exist|not exist|no such file|not found/i.test(getErrorMessage(error));

const shouldReadSmokeConfigFromFilesystem = () => {
  if (!Capacitor.isNativePlatform()) return false;
  if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return true;
  if (typeof window !== "undefined" && (window as SmokeBootstrapWindow).__c64uReadSmokeConfigFromFilesystem === true) {
    return true;
  }
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SMOKE_MODE_STORAGE_KEY) === "1";
};

const readSmokeConfigFromStorage = (): SmokeConfig | null => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(SMOKE_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  try {
    return parseSmokeConfig(JSON.parse(raw));
  } catch (error) {
    addLog("warn", "Failed to parse smoke config from storage", {
      error: (error as Error).message,
    });
    return null;
  }
};

const writeSmokeConfigToStorage = (config: SmokeConfig) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SMOKE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  localStorage.setItem(SMOKE_MODE_STORAGE_KEY, "1");
};

export const isSmokeModeEnabled = () => Boolean(cachedSmokeConfig);

export const getSmokeConfig = () => cachedSmokeConfig;

export const isSmokeReadOnlyEnabled = () => cachedSmokeConfig?.readOnly !== false;

export const initializeSmokeMode = async (): Promise<SmokeConfig | null> => {
  cachedSmokeConfig = null;

  let config = readSmokeConfigFromStorage();

  if (!config && shouldReadSmokeConfigFromFilesystem()) {
    try {
      const result = await Filesystem.readFile({
        path: SMOKE_CONFIG_FILENAME,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      config = parseSmokeConfig(JSON.parse(result.data));
    } catch (error) {
      if (isMissingFileError(error)) {
        addLog("debug", "Smoke config file not found; skipping native bootstrap", {
          path: SMOKE_CONFIG_FILENAME,
        });
      } else {
        addLog("warn", "Failed to read smoke config from filesystem", {
          error: (error as Error).message,
        });
      }
      config = null;
    }
  }

  if (!config) return null;

  cachedSmokeConfig = config;
  writeSmokeConfigToStorage(config);
  await persistSmokeFeatureFlags(config.featureFlags);

  if (config.debugLogging) {
    saveDebugLoggingEnabled(true);
  }

  if (config.host && typeof localStorage !== "undefined") {
    localStorage.setItem("c64u_device_host", config.host);
  }

  addLog("info", "Smoke mode enabled", {
    target: config.target,
    host: config.host,
    readOnly: config.readOnly,
  });
  console.info(
    "C64U_SMOKE_ENABLED",
    JSON.stringify({
      target: config.target,
      host: config.host,
      readOnly: config.readOnly,
    }),
  );

  return config;
};

export const recordSmokeStatus = async (status: { state: string; mode?: string; baseUrl?: string }) => {
  if (!cachedSmokeConfig || !Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.writeFile({
      path: SMOKE_STATUS_FILENAME,
      directory: Directory.Data,
      data: JSON.stringify({
        ...status,
        updatedAt: new Date().toISOString(),
      }),
      encoding: Encoding.UTF8,
    });
  } catch (error) {
    addLog("warn", "Failed to write smoke status", {
      error: (error as Error).message,
    });
  }
};
