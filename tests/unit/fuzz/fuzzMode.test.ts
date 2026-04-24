/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_SETTINGS_KEYS } from "@/lib/config/appSettings";
import {
  applyFuzzModeDefaults,
  fuzzModeKeys,
  getFuzzMockBaseUrl,
  isFuzzModeEnabled,
  isFuzzSafeBaseUrl,
  markFuzzModeEnabled,
  resetFuzzStorage,
} from "@/lib/fuzz/fuzzMode";

const { FUZZ_MODE_KEY, FUZZ_MOCK_BASE_URL_KEY, FUZZ_STORAGE_SEEDED_KEY } = fuzzModeKeys;
const OTHER_VARIANT_LOCAL_KEY = "c64u-controller:debug_logging_enabled";
const OTHER_VARIANT_SESSION_KEY = "c64u-controller:session";
const OTHER_LOCAL_KEY = "c64u_other";
const OTHER_SESSION_KEY = "c64u_other";

describe("fuzzMode", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as { __c64uFuzzMode?: boolean }).__c64uFuzzMode;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects fuzz mode from env flag", () => {
    vi.stubEnv("VITE_FUZZ_MODE", "1");
    expect(isFuzzModeEnabled()).toBe(true);
  });

  it("detects fuzz mode from window override", () => {
    (window as { __c64uFuzzMode?: boolean }).__c64uFuzzMode = true;
    expect(isFuzzModeEnabled()).toBe(true);
  });

  it("detects fuzz mode from localStorage flag", () => {
    expect(isFuzzModeEnabled()).toBe(false);
    markFuzzModeEnabled();
    expect(isFuzzModeEnabled()).toBe(true);
  });

  it("resets the stable c64u namespace and preserves mock base URL", () => {
    localStorage.setItem(FUZZ_MODE_KEY, "1");
    localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, "http://localhost:3001");
    localStorage.setItem(OTHER_LOCAL_KEY, "value");
    localStorage.setItem(OTHER_VARIANT_LOCAL_KEY, "keep-local");
    sessionStorage.setItem(OTHER_SESSION_KEY, "session-value");
    sessionStorage.setItem(OTHER_VARIANT_SESSION_KEY, "keep-session");

    resetFuzzStorage();

    expect(localStorage.getItem(FUZZ_MODE_KEY)).toBe("1");
    expect(getFuzzMockBaseUrl()).toBe("http://localhost:3001");
    expect(localStorage.getItem(OTHER_LOCAL_KEY)).toBeNull();
    expect(sessionStorage.getItem(OTHER_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(OTHER_VARIANT_LOCAL_KEY)).toBe("keep-local");
    expect(sessionStorage.getItem(OTHER_VARIANT_SESSION_KEY)).toBe("keep-session");
  });

  it("skips reset when already seeded", () => {
    localStorage.setItem(FUZZ_MODE_KEY, "1");
    localStorage.setItem(FUZZ_STORAGE_SEEDED_KEY, "1");
    localStorage.setItem("other", "value");

    resetFuzzStorage();

    expect(localStorage.getItem("other")).toBe("value");
  });

  it("applies default fuzz settings", () => {
    localStorage.setItem(FUZZ_MODE_KEY, "1");

    applyFuzzModeDefaults();

    expect(localStorage.getItem(FUZZ_STORAGE_SEEDED_KEY)).toBe("1");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY)).toBe("1");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.AUTO_DEMO_MODE_KEY)).toBe("1");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY)).toBe("500");
    expect(localStorage.getItem(APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY)).toBe("1500");
  });

  it("validates safe base URLs for fuzz mode", () => {
    localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, "http://localhost:5555");

    expect(isFuzzSafeBaseUrl("http://localhost:5555")).toBe(true);
    expect(isFuzzSafeBaseUrl("http://example.com")).toBe(false);
    expect(isFuzzSafeBaseUrl("relative/path")).toBe(false);
  });

  it("accepts non-http mock URLs as safe", () => {
    localStorage.setItem(FUZZ_MOCK_BASE_URL_KEY, "local");

    expect(isFuzzSafeBaseUrl("local")).toBe(true);
  });
});
