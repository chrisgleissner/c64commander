/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadDebugLoggingEnabled: vi.fn(() => false),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
}));

vi.mock("../../../src/lib/fuzz/fuzzMode", () => ({
  applyFuzzModeDefaults: vi.fn(),
  isFuzzModeEnabled: vi.fn(() => false),
  getFuzzMockBaseUrl: vi.fn(() => null),
}));

vi.mock("../../../src/lib/smoke/smokeMode", () => ({
  initializeSmokeMode: vi.fn(async () => null),
  getSmokeConfig: vi.fn(() => null),
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
  recordSmokeStatus: vi.fn(async () => undefined),
}));

vi.mock("../../../src/lib/c64api", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/c64api")>("../../../src/lib/c64api");
  return {
    ...actual,
    applyC64APIRuntimeConfig: vi.fn(),
  };
});

vi.mock("../../../src/lib/secureStorage", () => ({
  getPassword: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

const startMockServer = vi.fn(async () => {
  throw new Error("Mock C64U server is only available on native platforms.");
});
const stopMockServer = vi.fn(async () => undefined);

vi.mock("../../../src/lib/mock/mockServer", () => ({
  startMockServer,
  stopMockServer,
  getActiveMockBaseUrl: vi.fn(() => null),
  getActiveMockFtpPort: vi.fn(() => null),
}));

const ensureStorage = () => {
  const createMemoryStorage = () => {
    let store = new Map<string, string>();
    return {
      getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store = new Map();
      },
    };
  };

  if (!("localStorage" in globalThis)) {
    Object.defineProperty(globalThis, "localStorage", { value: createMemoryStorage(), configurable: true });
  }
  if (!("sessionStorage" in globalThis)) {
    Object.defineProperty(globalThis, "sessionStorage", { value: createMemoryStorage(), configurable: true });
  }
};

describe("connectionManager startup coverage", () => {
  beforeEach(() => {
    ensureStorage();
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    startMockServer.mockClear();
    stopMockServer.mockClear();
  });

  it("falls back to demo mode when the startup discovery window expires", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(getConnectionSnapshot().lastDiscoveryTrigger).toBe("startup");
    expect(startMockServer).toHaveBeenCalledTimes(1);
  });

  it("returns to REAL_CONNECTED when a background probe succeeds after demo fallback", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await discoverConnection("background");

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().lastDiscoveryTrigger).toBe("background");
  });
});
