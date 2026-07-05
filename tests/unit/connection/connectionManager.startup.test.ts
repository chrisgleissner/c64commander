/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutomaticDemoModeEnabled, loadStartupDiscoveryWindowMs } from "../../../src/lib/config/appSettings";
import { featureFlagManager } from "../../../src/lib/config/featureFlags";

const startDeviceDiscovery = vi.fn(async () => ({
  candidates: [],
  scannedHosts: 0,
  elapsedMs: 0,
  unsupported: false,
}));
const persistDiscoveredDevice = vi.fn((candidate: { address: string; httpPort: number }) => ({
  deviceId: "discovered-device",
  host: candidate.address,
  httpPort: candidate.httpPort,
  deviceHost: candidate.httpPort === 80 ? candidate.address : `${candidate.address}:${candidate.httpPort}`,
}));

vi.mock("../../../src/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery,
  persistDiscoveredDevice,
}));

vi.mock("../../../src/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => false),
  loadDebugLoggingEnabled: vi.fn(() => false),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
}));

vi.mock("../../../src/lib/config/featureFlags", () => ({
  featureFlagManager: {
    load: vi.fn(async () => undefined),
    getSnapshot: vi.fn(() => ({ flags: { demo_mode_enabled: false } })),
  },
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
  getPasswordForDevice: vi.fn(async () => null),
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
  getActiveMockToken: vi.fn(() => null),
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
    startDeviceDiscovery.mockClear();
    startDeviceDiscovery.mockResolvedValue({
      candidates: [],
      scannedHosts: 0,
      elapsedMs: 0,
      unsupported: false,
    });
    persistDiscoveredDevice.mockClear();
  });

  it("falls back to offline mode when the startup discovery window expires and explicit demo mode is disabled", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:1");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().lastDiscoveryTrigger).toBe("startup");
    expect(startMockServer).not.toHaveBeenCalled();
  });

  it("runs automatic discovery before probing the default host when no device has been configured", async () => {
    localStorage.setItem(
      "c64u_saved_devices:v1",
      JSON.stringify({
        version: 1,
        selectedDeviceId: "default-device",
        devices: [
          {
            id: "default-device",
            name: "c64u",
            nameSource: "INFERRED",
            host: "c64u",
            type: "",
            typeSource: "INFERRED",
            httpPort: 80,
            ftpPort: 21,
            telnetPort: 23,
            lastKnownProduct: null,
            lastKnownHostname: null,
            lastKnownUniqueId: null,
            lastSuccessfulConnectionAt: null,
            lastUsedAt: null,
            hasPassword: false,
          },
        ],
        summaries: {},
        summaryLru: [],
        hasEverHadMultipleDevices: false,
      }),
    );
    startDeviceDiscovery.mockResolvedValueOnce({
      candidates: [
        {
          id: "id:38c1ba",
          address: "192.168.1.13",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "Ultimate 64 Elite",
          firmwareVersion: "3.14e",
          fpgaVersion: "122",
          coreVersion: "1.4B",
          hostname: "u64",
          uniqueId: "38C1BA",
          requiresPassword: false,
          alreadySavedDeviceId: null,
          confidence: "verified",
          lastSeenAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 421,
      unsupported: false,
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    expect(startDeviceDiscovery).toHaveBeenCalledWith({
      trigger: "startup",
      includeLanScan: true,
      timeoutMs: 8000,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(persistDiscoveredDevice).not.toHaveBeenCalled();
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().deviceInfo).toBeNull();
    expect(getConnectionSnapshot().lastProbeError).toBeNull();
  });

  it("falls through to the normal startup probe when clean-install discovery finds no devices", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(1);

    expect(startDeviceDiscovery).toHaveBeenCalledWith({
      trigger: "startup",
      includeLanScan: true,
      timeoutMs: 8000,
    });
    expect(fetch).toHaveBeenCalled();
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().lastDiscoveryTrigger).toBe("startup");
  });

  it("keeps a discovered startup device available for user selection without auto-selecting it", async () => {
    startDeviceDiscovery.mockResolvedValueOnce({
      candidates: [
        {
          id: "id:38c1ba",
          address: "192.168.1.13",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "Ultimate 64 Elite",
          firmwareVersion: "3.14e",
          fpgaVersion: "122",
          coreVersion: "1.4B",
          hostname: "u64",
          uniqueId: "38C1BA",
          requiresPassword: false,
          alreadySavedDeviceId: null,
          confidence: "verified",
          lastSeenAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 421,
      unsupported: false,
    });

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "unreachable-device");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(startDeviceDiscovery).toHaveBeenCalledWith({
      trigger: "startup",
      includeLanScan: true,
      timeoutMs: 8000,
    });
    expect(persistDiscoveredDevice).not.toHaveBeenCalled();
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(getConnectionSnapshot().deviceInfo).toBeNull();
    expect(getConnectionSnapshot().lastProbeError).toBeNull();
  });

  it("connects to a reachable configured device instead of starting discovery when the selected one is unreachable", async () => {
    // Stale selected device + a reachable second device + a stale U2 entry (a valid
    // startup-policy input that is simply skipped because it does not answer).
    localStorage.setItem(
      "c64u_saved_devices:v1",
      JSON.stringify({
        version: 1,
        selectedDeviceId: "stale-selected",
        devices: [
          {
            id: "stale-selected",
            name: "stale",
            nameSource: "INFERRED",
            host: "unreachable-device",
            type: "",
            typeSource: "INFERRED",
            httpPort: 80,
            ftpPort: 21,
            telnetPort: 23,
            lastKnownProduct: null,
            lastKnownHostname: null,
            lastKnownUniqueId: null,
            lastSuccessfulConnectionAt: null,
            lastUsedAt: null,
            hasPassword: false,
          },
          {
            id: "reachable-u64",
            name: "Office U64",
            nameSource: "USER",
            host: "192.168.1.50",
            type: "U64E",
            typeSource: "INFERRED",
            httpPort: 80,
            ftpPort: 21,
            telnetPort: 23,
            lastKnownProduct: "U64E",
            lastKnownHostname: "u64",
            lastKnownUniqueId: "38C1BA",
            lastSuccessfulConnectionAt: null,
            lastUsedAt: null,
            hasPassword: false,
          },
          {
            id: "stale-u2",
            name: "Cartridge U2",
            nameSource: "USER",
            host: "203.0.113.9",
            type: "U2",
            typeSource: "INFERRED",
            httpPort: 80,
            ftpPort: 21,
            telnetPort: 23,
            lastKnownProduct: "U2",
            lastKnownHostname: "ultimate-ii",
            lastKnownUniqueId: "A1B2C3",
            lastSuccessfulConnectionAt: null,
            lastUsedAt: null,
            hasPassword: false,
          },
        ],
        summaries: {},
        summaryLru: [],
        hasEverHadMultipleDevices: true,
      }),
    );

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("192.168.1.50")) {
        return new Response(
          JSON.stringify({ product: "Ultimate 64 Elite", hostname: "u64", unique_id: "38C1BA", errors: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new TypeError("Failed to fetch");
    });

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");
    const { getSavedDevicesSnapshot } = await import("../../../src/lib/savedDevices/store");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(1500);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    // The reachable configured device was selected and connected — no LAN scan.
    expect(getSavedDevicesSnapshot().selectedDeviceId).toBe("reachable-u64");
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
  });

  it("returns to REAL_CONNECTED when a background probe succeeds after an offline startup timeout", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");

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

  it("runs the shared discovery path on resume and reconnects when the probe succeeds", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    void discoverConnection("resume");
    await vi.advanceTimersByTimeAsync(500);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().lastDiscoveryTrigger).toBe("resume");
  });

  it("waits for a slow successful startup probe inside the deadline instead of entering demo", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    localStorage.setItem("c64u_device_host", "127.0.0.1:9999");
    vi.mocked(featureFlagManager.getSnapshot).mockReturnValue({ flags: { demo_mode_enabled: true } } as never);
    vi.mocked(loadAutomaticDemoModeEnabled).mockReturnValue(true);
    vi.mocked(loadStartupDiscoveryWindowMs).mockReturnValue(600);
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }, 500);
        }),
    );

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(500);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(startMockServer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });
});
