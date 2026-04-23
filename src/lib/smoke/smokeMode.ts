/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { buildLocalStorageKey } from "@/generated/variant";
import { addLog } from "@/lib/logging";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import {
  featureFlagManager,
  isKnownFeatureFlagId,
  type FeatureFlagId,
  type FeatureFlags,
} from "@/lib/config/featureFlags";
import {
  buildBaseUrlFromDeviceHost,
  getC64APIConfigSnapshot,
  normalizeDeviceHost,
  updateC64APIConfig,
} from "@/lib/c64api";
import { collectHvscPerfTimings } from "@/lib/hvsc/hvscPerformance";
import { setHvscBaseUrlOverride } from "@/lib/hvsc/hvscReleaseService";

const SMOKE_CONFIG_STORAGE_KEY = buildLocalStorageKey("smoke_config");
const SMOKE_MODE_STORAGE_KEY = buildLocalStorageKey("smoke_mode_enabled");
const SMOKE_CONFIG_FILENAME = "c64u-smoke.json";
const SMOKE_STATUS_FILENAME = "c64u-smoke-status.json";
const SMOKE_BENCHMARK_FILENAME_PREFIX = "c64u-smoke-benchmark-";

export type SmokeTarget = "mock" | "real";
export type SmokeFeatureFlags = Partial<FeatureFlags>;
export type SmokeConfig = {
  target: SmokeTarget;
  host?: string;
  hvscBaseUrl?: string;
  benchmarkRunId?: string;
  readOnly?: boolean;
  debugLogging?: boolean;
  featureFlags?: SmokeFeatureFlags;
};

export type SmokeBenchmarkSnapshot = {
  scenario: string;
  state?: string;
  target: SmokeTarget;
  host?: string;
  hvscBaseUrl?: string;
  benchmarkRunId?: string;
  metadata?: Record<string, unknown>;
  hvscPerfTimings: ReturnType<typeof collectHvscPerfTimings>;
  updatedAt: string;
};

let cachedSmokeConfig: SmokeConfig | null = null;

type SmokeBootstrapWindow = Window & {
  __c64uReadSmokeConfigFromFilesystem?: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const parseSmokeFeatureFlags = (raw: unknown): SmokeFeatureFlags | undefined => {
  if (!isObject(raw)) return undefined;
  const featureFlags: SmokeFeatureFlags = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!isKnownFeatureFlagId(key) || typeof value !== "boolean") return;
    featureFlags[key] = value;
  });
  return Object.keys(featureFlags).length > 0 ? featureFlags : undefined;
};

const parseSmokeConfig = (raw: unknown): SmokeConfig | null => {
  if (!isObject(raw)) return null;
  const target = raw.target === "real" ? "real" : raw.target === "mock" ? "mock" : null;
  if (!target) return null;
  const host = typeof raw.host === "string" && raw.host.trim().length > 0 ? normalizeDeviceHost(raw.host) : undefined;
  const hvscBaseUrl =
    typeof raw.hvscBaseUrl === "string" && raw.hvscBaseUrl.trim().length > 0 ? raw.hvscBaseUrl.trim() : undefined;
  const benchmarkRunId =
    typeof raw.benchmarkRunId === "string" && raw.benchmarkRunId.trim().length > 0
      ? raw.benchmarkRunId.trim()
      : undefined;
  const readOnly = typeof raw.readOnly === "boolean" ? raw.readOnly : true;
  const debugLogging = typeof raw.debugLogging === "boolean" ? raw.debugLogging : true;
  const featureFlags = parseSmokeFeatureFlags(raw.featureFlags);
  return { target, host, hvscBaseUrl, benchmarkRunId, readOnly, debugLogging, featureFlags };
};

const sanitizeSmokeScenario = (scenario: string) =>
  scenario
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");

const writeSmokeFile = async (path: string, data: unknown) => {
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: JSON.stringify(data),
    encoding: Encoding.UTF8,
  });
};

const persistSmokeFeatureFlags = async (featureFlags: SmokeFeatureFlags | undefined) => {
  if (!featureFlags) return;
  await featureFlagManager.load();
  for (const [key, value] of Object.entries(featureFlags) as Array<[FeatureFlagId, boolean]>) {
    try {
      await featureFlagManager.applyBootstrapOverride(key, value);
    } catch (error) {
      addLog("warn", "Failed to apply smoke feature flag", {
        key,
        error: (error as Error).message,
      });
    }
  }
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
  return false;
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
    updateC64APIConfig(buildBaseUrlFromDeviceHost(config.host), getC64APIConfigSnapshot().password, config.host);
  }

  if (config.hvscBaseUrl) {
    setHvscBaseUrlOverride(config.hvscBaseUrl);
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
    await writeSmokeFile(SMOKE_STATUS_FILENAME, {
      ...status,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    addLog("warn", "Failed to write smoke status", {
      error: (error as Error).message,
    });
  }
};

/** Per-scenario write throttle: prevents flooding the Capacitor bridge
 *  with hundreds of 500 KB snapshot writes during bulk operations. */
const lastSnapshotWriteMs = new Map<string, number>();
const SMOKE_SNAPSHOT_THROTTLE_MS = 2_000;

export const recordSmokeBenchmarkSnapshot = async (input: {
  scenario: string;
  state?: string;
  metadata?: Record<string, unknown>;
}) => {
  if (!cachedSmokeConfig || !Capacitor.isNativePlatform()) return;
  const scenario = sanitizeSmokeScenario(input.scenario);
  if (!scenario) return;

  const now = Date.now();
  const lastWrite = lastSnapshotWriteMs.get(scenario) ?? 0;
  if (now - lastWrite < SMOKE_SNAPSHOT_THROTTLE_MS) return;
  lastSnapshotWriteMs.set(scenario, now);

  const snapshot: SmokeBenchmarkSnapshot = {
    scenario,
    state: input.state,
    target: cachedSmokeConfig.target,
    host: cachedSmokeConfig.host,
    hvscBaseUrl: cachedSmokeConfig.hvscBaseUrl,
    benchmarkRunId: cachedSmokeConfig.benchmarkRunId,
    metadata: input.metadata,
    hvscPerfTimings: collectHvscPerfTimings(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeSmokeFile(`${SMOKE_BENCHMARK_FILENAME_PREFIX}${scenario}.json`, snapshot);
  } catch (error) {
    addLog("warn", "Failed to write smoke benchmark snapshot", {
      scenario,
      error: (error as Error).message,
    });
  }
};
