/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { buildLocalStorageKey, buildSessionStorageKey } from "@/generated/variant";

const FUZZ_MODE_KEY = buildLocalStorageKey("fuzz_mode_enabled");
const FUZZ_MOCK_BASE_URL_KEY = buildLocalStorageKey("fuzz_mock_base_url");
const FUZZ_STORAGE_SEEDED_KEY = buildLocalStorageKey("fuzz_storage_seeded");
const DEBUG_LOGGING_KEY = buildLocalStorageKey("debug_logging_enabled");
const AUTO_DEMO_MODE_KEY = buildLocalStorageKey("automatic_demo_mode_enabled");
const STARTUP_DISCOVERY_WINDOW_MS_KEY = buildLocalStorageKey("startup_discovery_window_ms");
const BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY = buildLocalStorageKey("background_rediscovery_interval_ms");
const LOCAL_STORAGE_PREFIX = buildLocalStorageKey("");
const SESSION_STORAGE_PREFIX = buildSessionStorageKey("");

const clearPrefixedStorage = (storage: Storage, prefix: string) => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
};

const readStorageValue = (key: string) => {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(key);
};

export const isFuzzModeEnabled = () => {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.VITE_FUZZ_MODE === "1") return true;
  } catch (error) {
    console.warn("Failed to read fuzz mode flag", { error });
  }
  if (typeof window === "undefined") return false;
  if ((window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode) return true;
  return readStorageValue(FUZZ_MODE_KEY) === "1";
};

export const getFuzzMockBaseUrl = () => readStorageValue(FUZZ_MOCK_BASE_URL_KEY);

export const markFuzzModeEnabled = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(FUZZ_MODE_KEY, "1");
};

export const resetFuzzStorage = () => {
  if (!isFuzzModeEnabled()) return;
  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem(FUZZ_STORAGE_SEEDED_KEY) === "1") return;
    const fuzzMockBaseUrl = localStorage.getItem(FUZZ_MOCK_BASE_URL_KEY);
    clearPrefixedStorage(localStorage, LOCAL_STORAGE_PREFIX);
    localStorage.setItem(FUZZ_MODE_KEY, "1");
    if (fuzzMockBaseUrl) {
      localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, fuzzMockBaseUrl);
    }
  }
  if (typeof sessionStorage !== "undefined") {
    clearPrefixedStorage(sessionStorage, SESSION_STORAGE_PREFIX);
  }
};

export const applyFuzzModeDefaults = () => {
  if (!isFuzzModeEnabled()) return;
  if (typeof localStorage === "undefined") return;

  resetFuzzStorage();
  localStorage.setItem(FUZZ_STORAGE_SEEDED_KEY, "1");
  localStorage.setItem(DEBUG_LOGGING_KEY, "1");
  localStorage.setItem(AUTO_DEMO_MODE_KEY, "1");
  localStorage.setItem(STARTUP_DISCOVERY_WINDOW_MS_KEY, "500");
  localStorage.setItem(BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, "1500");
};

const isLocalHost = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0";

const isSafeMockBaseUrl = (value: string) => {
  try {
    const url = new URL(value);
    return isLocalHost(url.hostname);
  } catch (error) {
    console.warn("Failed to parse fuzz mock base URL", { value, error });
    return !value.startsWith("http://") && !value.startsWith("https://");
  }
};

export const isFuzzSafeBaseUrl = (baseUrl: string) => {
  const fuzzMock = getFuzzMockBaseUrl();
  if (fuzzMock && baseUrl === fuzzMock && isSafeMockBaseUrl(fuzzMock)) return true;
  try {
    const url = new URL(baseUrl);
    return isLocalHost(url.hostname);
  } catch (error) {
    console.warn("Failed to parse base URL for fuzz safety", {
      baseUrl,
      error,
    });
    return false;
  }
};

export const fuzzModeKeys = {
  FUZZ_MODE_KEY,
  FUZZ_MOCK_BASE_URL_KEY,
  FUZZ_STORAGE_SEEDED_KEY,
};
