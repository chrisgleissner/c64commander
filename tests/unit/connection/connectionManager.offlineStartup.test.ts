/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const startDeviceDiscovery = vi.fn(async () => ({
  candidates: [],
  scannedHosts: 0,
  elapsedMs: 0,
  unsupported: false,
}));

vi.mock("../../../src/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery,
  persistDiscoveredDevice: vi.fn(),
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

vi.mock("../../../src/lib/secureStorage", () => ({
  getPassword: vi.fn(async () => null),
  getPasswordForDevice: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

const MOCK_BASE_URL = "http://127.0.0.1:45999";
let activeMockBaseUrl: string | null = null;

const startMockServer = vi.fn(async () => {
  activeMockBaseUrl = MOCK_BASE_URL;
  return { baseUrl: MOCK_BASE_URL, ftpPort: 42121, token: "mock-token" };
});
const stopMockServer = vi.fn(async () => {
  activeMockBaseUrl = null;
});

vi.mock("../../../src/lib/mock/mockServer", () => ({
  startMockServer,
  stopMockServer,
  getActiveMockBaseUrl: vi.fn(() => activeMockBaseUrl),
  getActiveMockFtpPort: vi.fn(() => (activeMockBaseUrl ? 42121 : null)),
  getActiveMockToken: vi.fn(() => (activeMockBaseUrl ? "mock-token" : null)),
}));

const isNativePlatform = vi.fn(() => true);
vi.mock("../../../src/lib/native/platform", () => ({
  isNativePlatform: () => isNativePlatform(),
  getPlatform: () => "android",
}));

const getNetworkStatus = vi.fn(async () => ({ online: false, supported: true }));
vi.mock("../../../src/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: { getNetworkStatus: () => getNetworkStatus() },
}));

const setNetwork = (online: boolean, supported = true) => {
  getNetworkStatus.mockResolvedValue({ online, supported });
};

/**
 * Requests that left the device, as opposed to requests to the in-app simulated device.
 *
 * The simulated device is an HTTP server inside the app on loopback; talking to it is not network
 * traffic and is not what these tests forbid. What they forbid is a probe of the configured real
 * host while the platform says there is no network.
 */
const offDeviceRequests = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(typeof input === "string" ? input : ((input as Request).url ?? input)))
    .filter((url) => !url.startsWith(MOCK_BASE_URL));

const respondWithDevice = () =>
  new Response(JSON.stringify({ product: "C64 Ultimate", errors: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

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

describe("startup with no network on the device", () => {
  beforeEach(() => {
    ensureStorage();
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    activeMockBaseUrl = null;
    startMockServer.mockClear();
    stopMockServer.mockClear();
    startDeviceDiscovery.mockClear();
    isNativePlatform.mockReturnValue(true);
    setNetwork(false);
  });

  it("starts the simulated device on a fresh offline launch without scanning or probing", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(startMockServer).toHaveBeenCalledTimes(1);
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
    expect(offDeviceRequests()).toEqual([]);
  });

  it("asks the user before the simulated device stands in for the configured one", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    // The offline launch used to switch silently. Silently substituting a simulated device for
    // the hardware the user configured is indistinguishable, from the user's side, from the app
    // deciding their C64U is fine when it is simply unreachable.
    const snapshot = getConnectionSnapshot();
    expect(snapshot.demoInterstitialVisible).toBe(true);
    expect(snapshot.demoInterstitialReason).toBe("no-network");
  });

  it("does not ask a second time in the same session", async () => {
    const { discoverConnection, dismissDemoInterstitial, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    dismissDemoInterstitial();
    await discoverConnection("settings");

    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("never asks on a background trigger", async () => {
    const { discoverConnection, dismissDemoInterstitial, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    dismissDemoInterstitial();
    await discoverConnection("background");

    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("keeps the user in Demo Mode when they confirm from the offline prompt", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager, pinDemoModeByUserChoice } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    await pinDemoModeByUserChoice();

    const snapshot = getConnectionSnapshot();
    expect(snapshot.state).toBe("DEMO_ACTIVE");
    expect(snapshot.demoInterstitialVisible).toBe(false);
    expect(snapshot.demoInterstitialReason).toBeNull();
  });

  it("reads the simulated device's identity, so capability-gated features are offered in Demo Mode", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(typeof input === "string" ? input : ((input as Request).url ?? input));
      if (!url.startsWith(MOCK_BASE_URL)) throw new TypeError("Failed to fetch");
      return new Response(
        JSON.stringify({ product: "C64 Ultimate", core_version: "V1.48", hostname: "demo", errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await initializeConnectionManager();
    await discoverConnection("startup");
    await vi.waitFor(() => expect(getConnectionSnapshot().deviceInfo).not.toBeNull());

    // Without an identity, `deriveDeviceCapabilities` has only a config read to go on, and Live
    // View — the feature Demo Mode exists to show — was absent from Home until that read landed.
    const snapshot = getConnectionSnapshot();
    expect(snapshot.state).toBe("DEMO_ACTIVE");
    expect(snapshot.deviceInfo?.core_version).toBe("V1.48");
    expect(offDeviceRequests()).toEqual([]);
  });

  it("records the reason as a missing network rather than a failed probe", async () => {
    const { NO_NETWORK_PROBE_ERROR, discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    const snapshot = getConnectionSnapshot();
    expect(snapshot.lastProbeError).toBe(NO_NETWORK_PROBE_ERROR);
    expect(snapshot.lastProbeFailedAtMs).toBeNull();
    expect(snapshot.lastProbeAtMs).toBeNull();
  });

  it("needs neither the Demo Mode feature flag nor the Demo Mode setting", async () => {
    const { featureFlagManager } = await import("../../../src/lib/config/featureFlags");
    const { loadAutomaticDemoModeEnabled } = await import("../../../src/lib/config/appSettings");
    expect(vi.mocked(featureFlagManager.getSnapshot)()).toEqual({ flags: { demo_mode_enabled: false } });
    expect(vi.mocked(loadAutomaticDemoModeEnabled)()).toBe(false);

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
  });

  it("makes no background probe while the device stays offline", async () => {
    const { discoverConnection, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    await discoverConnection("background");

    expect(offDeviceRequests()).toEqual([]);
  });

  it("does not scan when entering Demo Mode re-routes the API and re-triggers discovery", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    await discoverConnection("settings");

    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
    expect(offDeviceRequests()).toEqual([]);
  });

  it("does not record the simulated device answering as a real device found", async () => {
    const {
      NO_NETWORK_PROBE_ERROR,
      discoverConnection,
      getConnectionSnapshot,
      initializeConnectionManager,
      noteReachable,
    } = await import("../../../src/lib/connection/connectionManager");
    const { getC64APIConfigSnapshot } = await import("../../../src/lib/c64api");

    await initializeConnectionManager();
    await discoverConnection("startup");
    expect(getC64APIConfigSnapshot().baseUrl).toBe(MOCK_BASE_URL);

    noteReachable(MOCK_BASE_URL, "rest", { product: "C64 Ultimate", errors: [] } as never);

    const snapshot = getConnectionSnapshot();
    expect(snapshot.lastProbeSucceededAtMs).toBeNull();
    expect(snapshot.lastProbeError).toBe(NO_NETWORK_PROBE_ERROR);
    // The identity on show is the simulated device's, so it is still recorded.
    expect(snapshot.deviceInfo).toMatchObject({ product: "C64 Ultimate" });
  });

  it("connects to the real device once the network comes back", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    setNetwork(true);
    vi.mocked(fetch).mockResolvedValue(respondWithDevice());
    await discoverConnection("background");

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(stopMockServer).toHaveBeenCalled();
  });

  it("lets the tester leave the simulated device by configuring real hardware", async () => {
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    await discoverConnection("startup");
    expect(getConnectionSnapshot().state).toBe("DEMO_ACTIVE");

    setNetwork(true);
    localStorage.setItem("c64u_device_host", "192.168.1.64");
    vi.mocked(fetch).mockResolvedValue(respondWithDevice());
    void discoverConnection("settings");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(stopMockServer).toHaveBeenCalled();
  });

  it("keeps the normal discovery flow on a platform that cannot report connectivity", async () => {
    setNetwork(false, false);
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    localStorage.setItem("c64u_device_host", "unreachable-device");
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(startMockServer).not.toHaveBeenCalled();
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("keeps the normal discovery flow on the web build", async () => {
    isNativePlatform.mockReturnValue(false);
    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    localStorage.setItem("c64u_device_host", "unreachable-device");
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(startMockServer).not.toHaveBeenCalled();
    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });
});

describe("startup with a network on the device", () => {
  beforeEach(() => {
    ensureStorage();
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    activeMockBaseUrl = null;
    startMockServer.mockClear();
    stopMockServer.mockClear();
    startDeviceDiscovery.mockClear();
    isNativePlatform.mockReturnValue(true);
    setNetwork(true);
  });

  it("claims the discovering state before its first await, so a second trigger cannot strand it", async () => {
    localStorage.setItem("c64u_device_host", "192.168.1.64");

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    const started = discoverConnection("startup");

    expect(getConnectionSnapshot().state).toBe("DISCOVERING");

    await vi.advanceTimersByTimeAsync(800);
    await started;
    expect(getConnectionSnapshot().state).not.toBe("DISCOVERING");
  });

  it("connects to a reachable real device instead of the simulated one", async () => {
    vi.mocked(fetch).mockResolvedValue(respondWithDevice());
    localStorage.setItem("c64u_device_host", "192.168.1.64");

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);

    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(startMockServer).not.toHaveBeenCalled();
  });

  it("reports an unreachable device as offline rather than presenting a simulated one", async () => {
    localStorage.setItem("c64u_device_host", "192.168.1.64");

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(800);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(startMockServer).not.toHaveBeenCalled();
    expect(getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("does not replace a connected real device with the simulated one when the network drops", async () => {
    vi.mocked(fetch).mockResolvedValue(respondWithDevice());
    localStorage.setItem("c64u_device_host", "192.168.1.64");

    const { discoverConnection, getConnectionSnapshot, initializeConnectionManager } =
      await import("../../../src/lib/connection/connectionManager");

    await initializeConnectionManager();
    void discoverConnection("startup");
    await vi.advanceTimersByTimeAsync(50);
    expect(getConnectionSnapshot().state).toBe("REAL_CONNECTED");

    setNetwork(false);
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    void discoverConnection("manual");
    await vi.advanceTimersByTimeAsync(4000);

    expect(getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(startMockServer).not.toHaveBeenCalled();
  });
});
