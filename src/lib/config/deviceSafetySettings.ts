/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  getSelectedSavedDevice,
  getSelectedSavedDeviceFirmwareSync,
  getSelectedSavedDeviceProductFamilySync,
  type ProductFamilyCode,
} from "@/lib/savedDevices/store";

export type DeviceSafetyMode = "AUTO" | "RELAXED" | "BALANCED" | "CONSERVATIVE" | "TROUBLESHOOTING";
type ConcreteDeviceSafetyMode = Exclude<DeviceSafetyMode, "AUTO">;

export type ResolvedSafetyPreset = "BALANCED" | "CONSERVATIVE";

export type AutoResolutionContext = {
  activeProduct: ProductFamilyCode | null;
  activeDeviceId: string | null;
  // firmware_version last reported by the active device (e.g. "1.1.0", "3.14e"),
  // or null/undefined if not yet known. Used to pick a higher profile only on
  // firmware versions that ship the Ultimate network-stack fixes. Optional so
  // callers that only need product context don't have to supply it (treated as
  // "unknown" → safety-first).
  activeFirmware?: string | null;
};

export type AutoResolution = {
  storedMode: DeviceSafetyMode;
  effectiveMode: ConcreteDeviceSafetyMode;
  resolvedPreset: ResolvedSafetyPreset | null;
  isProvisional: boolean;
  reason: string;
};

export type DeviceSafetyConfig = {
  mode: DeviceSafetyMode;
  ftpMaxConcurrency: number;
  // Max concurrent native REST connections the app may open to the device at
  // once. The Ultimate firmware runs a single-threaded network task on a single
  // shared Rx/Tx WiFi buffer; on builds without the 3.14x lwIP fixes (e.g. c64u
  // 1.1.0) concurrent connections starve Tx and can wedge the TCP stack until a
  // power-cycle. CONSERVATIVE = 1 (fully serialized); higher profiles allow more.
  restMaxConcurrency: number;
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
  resolution?: AutoResolution;
};

const DEVICE_SAFETY_MODE_KEY = "c64u_device_safety_mode";
const FTP_MAX_CONCURRENCY_KEY = "c64u_device_safety_ftp_max_concurrency";
const REST_MAX_CONCURRENCY_KEY = "c64u_device_safety_rest_max_concurrency";
const INFO_CACHE_MS_KEY = "c64u_device_safety_info_cache_ms";
const CONFIGS_CACHE_MS_KEY = "c64u_device_safety_configs_cache_ms";
const CONFIGS_COOLDOWN_MS_KEY = "c64u_device_safety_configs_cooldown_ms";
const DRIVES_COOLDOWN_MS_KEY = "c64u_device_safety_drives_cooldown_ms";
const FTP_LIST_COOLDOWN_MS_KEY = "c64u_device_safety_ftp_list_cooldown_ms";
const BACKOFF_BASE_MS_KEY = "c64u_device_safety_backoff_base_ms";
const BACKOFF_MAX_MS_KEY = "c64u_device_safety_backoff_max_ms";
const BACKOFF_FACTOR_KEY = "c64u_device_safety_backoff_factor";
const CIRCUIT_BREAKER_THRESHOLD_KEY = "c64u_device_safety_circuit_breaker_threshold";
const CIRCUIT_BREAKER_COOLDOWN_MS_KEY = "c64u_device_safety_circuit_breaker_cooldown_ms";
const DISCOVERY_PROBE_INTERVAL_MS_KEY = "c64u_device_safety_discovery_probe_interval_ms";
const ALLOW_USER_OVERRIDE_CIRCUIT_KEY = "c64u_device_safety_allow_user_override_circuit";
const APP_SETTINGS_CONFIG_WRITE_INTERVAL_KEY = "c64u_config_write_min_interval_ms";

export const DEFAULT_DEVICE_SAFETY_MODE: DeviceSafetyMode = "AUTO";

const MODE_DEFAULTS: Record<ConcreteDeviceSafetyMode, Omit<DeviceSafetyConfig, "mode" | "resolution">> = {
  RELAXED: {
    ftpMaxConcurrency: 3,
    restMaxConcurrency: 3,
    infoCacheMs: 200,
    configsCacheMs: 400,
    configsCooldownMs: 200,
    drivesCooldownMs: 200,
    ftpListCooldownMs: 100,
    backoffBaseMs: 100,
    backoffMaxMs: 1500,
    backoffFactor: 1.5,
    circuitBreakerThreshold: 6,
    circuitBreakerCooldownMs: 2000,
    discoveryProbeIntervalMs: 400,
    allowUserOverrideCircuit: true,
  },
  BALANCED: {
    ftpMaxConcurrency: 2,
    restMaxConcurrency: 2,
    infoCacheMs: 600,
    configsCacheMs: 1000,
    configsCooldownMs: 500,
    drivesCooldownMs: 500,
    ftpListCooldownMs: 300,
    backoffBaseMs: 200,
    backoffMaxMs: 3000,
    backoffFactor: 1.8,
    circuitBreakerThreshold: 4,
    circuitBreakerCooldownMs: 4000,
    discoveryProbeIntervalMs: 700,
    allowUserOverrideCircuit: true,
  },
  CONSERVATIVE: {
    ftpMaxConcurrency: 1,
    restMaxConcurrency: 1,
    infoCacheMs: 1200,
    configsCacheMs: 2000,
    configsCooldownMs: 1200,
    drivesCooldownMs: 1000,
    ftpListCooldownMs: 800,
    backoffBaseMs: 300,
    backoffMaxMs: 6000,
    backoffFactor: 2,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 6000,
    discoveryProbeIntervalMs: 1000,
    allowUserOverrideCircuit: false,
  },
  TROUBLESHOOTING: {
    ftpMaxConcurrency: 1,
    restMaxConcurrency: 1,
    infoCacheMs: 300,
    configsCacheMs: 600,
    configsCooldownMs: 300,
    drivesCooldownMs: 300,
    ftpListCooldownMs: 200,
    backoffBaseMs: 200,
    backoffMaxMs: 1200,
    backoffFactor: 1.4,
    circuitBreakerThreshold: 2,
    circuitBreakerCooldownMs: 2000,
    discoveryProbeIntervalMs: 500,
    allowUserOverrideCircuit: true,
  },
};

const readString = (key: string) => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  return raw ?? null;
};

const readNumber = (key: string) => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const readBoolean = (key: string) => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  return raw === "1";
};

const clampNumber = (value: number, min: number, max: number, step = 1) => {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  return Math.round(clamped / step) * step;
};

const normalizeMode = (mode?: string | null): DeviceSafetyMode => {
  if (
    mode === "AUTO" ||
    mode === "RELAXED" ||
    mode === "BALANCED" ||
    mode === "CONSERVATIVE" ||
    mode === "TROUBLESHOOTING"
  ) {
    return mode;
  }
  if (mode === null || mode === undefined) {
    return DEFAULT_DEVICE_SAFETY_MODE;
  }
  return "BALANCED";
};

// Firmware at/above which the Ultimate network stack ships the lwIP socket-timeout,
// socket-polling, and Tx-starvation fixes (GideonZ/1541ultimate 57c7c8a6a /
// ddd28dd17 / fdb521a5b / 802d6143b, 3.14d/3.14e line). U64-family builds at or
// above this tolerate BALANCED. (>= 3.14d also covers 3.14e.)
const U64_NETWORK_FIXED_MIN_FIRMWARE = "3.14d";
// C64U uses a 1.x firmware scheme; builds after 1.1.0 ship the fixes. C64U builds
// up to and including 1.1.0 — and any 3.14x C64U build, including the first one
// (3.14e) — do NOT have them and need CONSERVATIVE.
const C64U_NETWORK_FIXED_MIN_FIRMWARE = "1.1.0";

type ParsedFirmware = { nums: number[]; suffix: string };
const parseFirmware = (value: string | null | undefined): ParsedFirmware | null => {
  if (!value) return null;
  const match = /^\s*v?(\d+(?:\.\d+)*)\s*([a-z])?/i.exec(value.trim());
  if (!match) return null;
  const nums = match[1].split(".").map((part) => Number.parseInt(part, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return { nums, suffix: (match[2] ?? "").toLowerCase() };
};

// Comparator (negative / 0 / positive), or null if either side is unparseable.
// Compares numeric dotted parts first, then a trailing letter ("3.14d" < "3.14e").
const compareFirmware = (a: string | null | undefined, b: string): number | null => {
  const pa = parseFirmware(a);
  const pb = parseFirmware(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (pa.suffix === pb.suffix) return 0;
  return pa.suffix < pb.suffix ? -1 : 1;
};

export const resolveAutoSafetyMode = (stored: DeviceSafetyMode, ctx: AutoResolutionContext): AutoResolution => {
  const resolved = (
    effectiveMode: ConcreteDeviceSafetyMode,
    reason: string,
    isProvisional = false,
  ): AutoResolution => ({
    storedMode: stored,
    effectiveMode,
    resolvedPreset: effectiveMode === "BALANCED" || effectiveMode === "CONSERVATIVE" ? effectiveMode : null,
    isProvisional,
    reason,
  });
  if (stored !== "AUTO") {
    return {
      storedMode: stored,
      effectiveMode: stored,
      resolvedPreset: null,
      isProvisional: false,
      reason: "explicit-user-choice",
    };
  }

  const fw = ctx.activeFirmware;

  // C64U: any 3.14x build (incl. the first firmware, 3.14e) and any 1.x build up
  // to and including 1.1.0 lack the network fixes → CONSERVATIVE. Firmware after
  // 1.1.0 ships them → BALANCED. Until the firmware is known, stay CONSERVATIVE
  // (safety-first) and mark provisional so it re-resolves once /v1/info arrives.
  if (ctx.activeProduct === "C64U") {
    const parsed = parseFirmware(fw);
    if (!parsed) return resolved("CONSERVATIVE", "auto-c64u-firmware-unknown", true);
    if (parsed.nums[0] === 3) return resolved("CONSERVATIVE", "auto-c64u-3.14x");
    const cmp = compareFirmware(fw, C64U_NETWORK_FIXED_MIN_FIRMWARE);
    return cmp !== null && cmp > 0
      ? resolved("BALANCED", "auto-c64u-firmware-fixed")
      : resolved("CONSERVATIVE", "auto-c64u-firmware-unfixed");
  }

  // Ultimate II family (U2). No U2 hardware is available to characterise its network
  // stack, so use the CONSERVATIVE preset as the safety-first default (gentler request
  // rate). Documented assumption — see PLANS.md capability table.
  if (ctx.activeProduct === "U2") {
    return resolved("CONSERVATIVE", "auto-u2");
  }

  // U64 / U64 Elite / U64 Elite II: BALANCED once the firmware is at/above the
  // network-fixed line, else CONSERVATIVE. Unknown firmware stays CONSERVATIVE
  // (safety-first, provisional) until /v1/info confirms it.
  if (ctx.activeProduct === "U64" || ctx.activeProduct === "U64E" || ctx.activeProduct === "U64E2") {
    const cmp = compareFirmware(fw, U64_NETWORK_FIXED_MIN_FIRMWARE);
    if (cmp === null) return resolved("CONSERVATIVE", "auto-u64-firmware-unknown", true);
    return cmp >= 0
      ? resolved("BALANCED", "auto-u64-firmware-fixed")
      : resolved("CONSERVATIVE", "auto-u64-firmware-old");
  }

  return resolved("BALANCED", "auto-no-verified-product", true);
};

export const getActiveAutoResolutionContext = (): AutoResolutionContext => ({
  activeProduct: getSelectedSavedDeviceProductFamilySync(),
  activeDeviceId: getSelectedSavedDevice()?.id ?? null,
  activeFirmware: getSelectedSavedDeviceFirmwareSync(),
});

const broadcast = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("c64u-device-safety-updated", { detail: { key, value } }));
};

export const subscribeDeviceSafetyUpdates = (listener: (detail: { key?: string; value?: unknown }) => void) => {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<{ key?: string; value?: unknown }>).detail ?? {});
  };
  window.addEventListener("c64u-device-safety-updated", handler as EventListener);
  return () => window.removeEventListener("c64u-device-safety-updated", handler as EventListener);
};

export const loadDeviceSafetyMode = (): DeviceSafetyMode => normalizeMode(readString(DEVICE_SAFETY_MODE_KEY));

export const saveDeviceSafetyMode = (mode: DeviceSafetyMode) => {
  if (typeof localStorage === "undefined") return;
  const normalized = normalizeMode(mode);
  localStorage.setItem(DEVICE_SAFETY_MODE_KEY, normalized);
  broadcast(DEVICE_SAFETY_MODE_KEY, normalized);
};

export const resetDeviceSafetyOverrides = () => {
  if (typeof localStorage === "undefined") return;
  [
    FTP_MAX_CONCURRENCY_KEY,
    REST_MAX_CONCURRENCY_KEY,
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
    APP_SETTINGS_CONFIG_WRITE_INTERVAL_KEY,
  ].forEach((key) => localStorage.removeItem(key));
  broadcast("c64u-device-safety-reset", Date.now());
  window.dispatchEvent(
    new CustomEvent("c64u-app-settings-updated", {
      detail: { key: APP_SETTINGS_CONFIG_WRITE_INTERVAL_KEY },
    }),
  );
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
  const resolution = resolveAutoSafetyMode(mode, getActiveAutoResolutionContext());
  const defaults = MODE_DEFAULTS[resolution.effectiveMode];
  return {
    mode,
    ftpMaxConcurrency: clampNumber(resolveOverride(FTP_MAX_CONCURRENCY_KEY, defaults.ftpMaxConcurrency), 1, 4, 1),
    restMaxConcurrency: clampNumber(resolveOverride(REST_MAX_CONCURRENCY_KEY, defaults.restMaxConcurrency), 1, 4, 1),
    infoCacheMs: clampNumber(resolveOverride(INFO_CACHE_MS_KEY, defaults.infoCacheMs), 0, 5000, 50),
    configsCacheMs: clampNumber(resolveOverride(CONFIGS_CACHE_MS_KEY, defaults.configsCacheMs), 0, 10000, 50),
    configsCooldownMs: clampNumber(resolveOverride(CONFIGS_COOLDOWN_MS_KEY, defaults.configsCooldownMs), 0, 10000, 50),
    drivesCooldownMs: clampNumber(resolveOverride(DRIVES_COOLDOWN_MS_KEY, defaults.drivesCooldownMs), 0, 10000, 50),
    ftpListCooldownMs: clampNumber(resolveOverride(FTP_LIST_COOLDOWN_MS_KEY, defaults.ftpListCooldownMs), 0, 10000, 50),
    backoffBaseMs: clampNumber(resolveOverride(BACKOFF_BASE_MS_KEY, defaults.backoffBaseMs), 0, 10000, 50),
    backoffMaxMs: clampNumber(resolveOverride(BACKOFF_MAX_MS_KEY, defaults.backoffMaxMs), 0, 20000, 50),
    backoffFactor: clampNumber(resolveOverride(BACKOFF_FACTOR_KEY, defaults.backoffFactor), 1, 3, 0.1),
    circuitBreakerThreshold: clampNumber(
      resolveOverride(CIRCUIT_BREAKER_THRESHOLD_KEY, defaults.circuitBreakerThreshold),
      0,
      10,
      1,
    ),
    circuitBreakerCooldownMs: clampNumber(
      resolveOverride(CIRCUIT_BREAKER_COOLDOWN_MS_KEY, defaults.circuitBreakerCooldownMs),
      0,
      20000,
      100,
    ),
    discoveryProbeIntervalMs: clampNumber(
      resolveOverride(DISCOVERY_PROBE_INTERVAL_MS_KEY, defaults.discoveryProbeIntervalMs),
      200,
      2000,
      50,
    ),
    allowUserOverrideCircuit: resolveBooleanOverride(
      ALLOW_USER_OVERRIDE_CIRCUIT_KEY,
      defaults.allowUserOverrideCircuit,
    ),
    resolution,
  };
};

const saveNumberOverride = (key: string, value: number) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, String(value));
  broadcast(key, value);
};

const saveBooleanOverride = (key: string, value: boolean) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, value ? "1" : "0");
  broadcast(key, value);
};

export const saveFtpMaxConcurrency = (value: number) =>
  saveNumberOverride(FTP_MAX_CONCURRENCY_KEY, clampNumber(value, 1, 4, 1));

export const saveRestMaxConcurrency = (value: number) =>
  saveNumberOverride(REST_MAX_CONCURRENCY_KEY, clampNumber(value, 1, 4, 1));

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
