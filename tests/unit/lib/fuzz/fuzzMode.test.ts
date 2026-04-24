/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_SETTINGS_KEYS } from "@/lib/config/appSettings";

const FUZZ_MODE_KEY = "c64u_fuzz_mode_enabled";
const FUZZ_MOCK_BASE_URL_KEY = "c64u_fuzz_mock_base_url";
const FUZZ_STORAGE_SEEDED_KEY = "c64u_fuzz_storage_seeded";
const TEMP_LOCAL_KEY = "c64u_temp";
const TEMP_SESSION_KEY = "c64u_temp";

const createStorageMock = () => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
};

describe("fuzzMode", () => {
  let localStorageMock: {
    readonly length: number;
    key: ReturnType<typeof vi.fn>;
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let sessionStorageMock: {
    readonly length: number;
    key: ReturnType<typeof vi.fn>;
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorageMock = createStorageMock();
    sessionStorageMock = createStorageMock();
    Object.defineProperty(global, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, "sessionStorage", {
      value: sessionStorageMock,
      writable: true,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    delete (window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode;
  });

  describe("isFuzzModeEnabled", () => {
    it("returns false when no fuzz mode indicators are set", async () => {
      localStorageMock.getItem.mockReturnValue(null);
      const { isFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      expect(isFuzzModeEnabled()).toBe(false);
    });

    it("returns true when localStorage has fuzz mode enabled", async () => {
      localStorageMock.getItem.mockReturnValue("1");
      const { isFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      expect(isFuzzModeEnabled()).toBe(true);
    });

    it("returns true when window.__c64uFuzzMode is set", async () => {
      (window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode = true;
      const { isFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      expect(isFuzzModeEnabled()).toBe(true);
    });

    it('returns false when localStorage value is not "1"', async () => {
      localStorageMock.getItem.mockReturnValue("0");
      const { isFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      expect(isFuzzModeEnabled()).toBe(false);
    });
  });

  describe("getFuzzMockBaseUrl", () => {
    it("returns null when no base URL is set", async () => {
      localStorageMock.getItem.mockReturnValue(null);
      const { getFuzzMockBaseUrl } = await import("@/lib/fuzz/fuzzMode");
      expect(getFuzzMockBaseUrl()).toBeNull();
    });

    it("returns the base URL when set", async () => {
      localStorageMock.getItem.mockReturnValue("http://localhost:8064");
      const { getFuzzMockBaseUrl } = await import("@/lib/fuzz/fuzzMode");
      expect(getFuzzMockBaseUrl()).toBe("http://localhost:8064");
    });
  });

  describe("markFuzzModeEnabled", () => {
    it("sets fuzz mode in localStorage", async () => {
      const { markFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      markFuzzModeEnabled();
      expect(localStorageMock.setItem).toHaveBeenCalledWith(FUZZ_MODE_KEY, "1");
    });

    it("does nothing when localStorage is undefined", async () => {
      Object.defineProperty(global, "localStorage", {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const { markFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      expect(() => markFuzzModeEnabled()).not.toThrow();
    });
  });

  describe("resetFuzzStorage", () => {
    it("does nothing when fuzz mode is not enabled", async () => {
      const { resetFuzzStorage } = await import("@/lib/fuzz/fuzzMode");
      resetFuzzStorage();
      expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it("clears storage when fuzz mode is enabled", async () => {
      localStorageMock.setItem(FUZZ_MODE_KEY, "1");
      localStorageMock.setItem(TEMP_LOCAL_KEY, "clear-me");
      sessionStorageMock.setItem(TEMP_SESSION_KEY, "clear-me");
      const { resetFuzzStorage } = await import("@/lib/fuzz/fuzzMode");
      resetFuzzStorage();
      expect(localStorageMock.getItem(FUZZ_MODE_KEY)).toBe("1");
      expect(localStorageMock.getItem(TEMP_LOCAL_KEY)).toBeNull();
      expect(sessionStorageMock.getItem(TEMP_SESSION_KEY)).toBeNull();
    });

    it("preserves fuzz mock base URL when clearing", async () => {
      localStorageMock.setItem(FUZZ_MODE_KEY, "1");
      localStorageMock.setItem(FUZZ_MOCK_BASE_URL_KEY, "http://localhost:3000");
      const { resetFuzzStorage } = await import("@/lib/fuzz/fuzzMode");
      resetFuzzStorage();
      expect(localStorageMock.getItem(FUZZ_MOCK_BASE_URL_KEY)).toBe("http://localhost:3000");
    });

    it("does not clear if already seeded", async () => {
      localStorageMock.setItem(FUZZ_MODE_KEY, "1");
      localStorageMock.setItem(FUZZ_STORAGE_SEEDED_KEY, "1");
      localStorageMock.setItem(TEMP_LOCAL_KEY, "still-here");
      const { resetFuzzStorage } = await import("@/lib/fuzz/fuzzMode");
      resetFuzzStorage();
      expect(localStorageMock.getItem(TEMP_LOCAL_KEY)).toBe("still-here");
    });
  });

  describe("applyFuzzModeDefaults", () => {
    it("does nothing when fuzz mode is not enabled", async () => {
      localStorageMock.getItem.mockReturnValue(null);
      const { applyFuzzModeDefaults } = await import("@/lib/fuzz/fuzzMode");
      applyFuzzModeDefaults();
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it("applies defaults when fuzz mode is enabled", async () => {
      localStorageMock.setItem(FUZZ_MODE_KEY, "1");
      const { applyFuzzModeDefaults } = await import("@/lib/fuzz/fuzzMode");
      applyFuzzModeDefaults();
      expect(localStorageMock.getItem(FUZZ_STORAGE_SEEDED_KEY)).toBe("1");
      expect(localStorageMock.getItem(APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY)).toBe("1");
      expect(localStorageMock.getItem(APP_SETTINGS_KEYS.AUTO_DEMO_MODE_KEY)).toBe("1");
    });

    it("returns early when localStorage is undefined even if fuzz mode is enabled via window flag", async () => {
      // Covers the if (typeof localStorage === 'undefined') return branch in applyFuzzModeDefaults
      (window as Window & { __c64uFuzzMode?: boolean }).__c64uFuzzMode = true;
      Object.defineProperty(global, "localStorage", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { applyFuzzModeDefaults } = await import("@/lib/fuzz/fuzzMode");
      expect(() => applyFuzzModeDefaults()).not.toThrow();

      // Restore
      Object.defineProperty(global, "localStorage", {
        value: localStorageMock,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("platform edge cases", () => {
    it("readStorageValue returns null when localStorage is undefined", async () => {
      // Covers: if (typeof localStorage === 'undefined') return null in readStorageValue
      Object.defineProperty(global, "localStorage", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { getFuzzMockBaseUrl } = await import("@/lib/fuzz/fuzzMode");
      expect(getFuzzMockBaseUrl()).toBeNull();

      // Restore
      Object.defineProperty(global, "localStorage", {
        value: localStorageMock,
        writable: true,
        configurable: true,
      });
    });

    it("isFuzzModeEnabled returns false when window is undefined", async () => {
      // Covers: if (typeof window === 'undefined') return false in isFuzzModeEnabled
      const savedWindow = globalThis.window;
      Object.defineProperty(globalThis, "window", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { isFuzzModeEnabled } = await import("@/lib/fuzz/fuzzMode");
      expect(isFuzzModeEnabled()).toBe(false);

      Object.defineProperty(globalThis, "window", {
        value: savedWindow,
        writable: true,
        configurable: true,
      });
    });
  });
});
