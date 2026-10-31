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

vi.mock("@/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery,
  persistDiscoveredDevice: vi.fn(),
  discardDeviceDiscovery: vi.fn(),
}));

vi.mock("@/lib/config/appSettings", () => ({
  loadAutomaticDemoModeEnabled: vi.fn(() => true),
  loadDebugLoggingEnabled: vi.fn(() => false),
  loadDiscoveryProbeTimeoutMs: vi.fn(() => 2500),
  loadStartupDiscoveryWindowMs: vi.fn(() => 600),
}));

vi.mock("@/lib/config/featureFlags", () => ({
  featureFlagManager: {
    load: vi.fn(async () => undefined),
    getSnapshot: () => ({ flags: { demo_mode_enabled: true } }),
  },
}));

vi.mock("@/lib/fuzz/fuzzMode", () => ({
  applyFuzzModeDefaults: vi.fn(),
  isFuzzModeEnabled: vi.fn(() => false),
  getFuzzMockBaseUrl: vi.fn(() => null),
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  initializeSmokeMode: vi.fn(async () => null),
  getSmokeConfig: vi.fn(() => null),
  isSmokeModeEnabled: vi.fn(() => false),
  isSmokeReadOnlyEnabled: vi.fn(() => true),
  recordSmokeStatus: vi.fn(async () => undefined),
}));

vi.mock("@/lib/secureStorage", () => ({
  getPassword: vi.fn(async () => null),
  getPasswordForDevice: vi.fn(async () => null),
  setPassword: vi.fn(async () => undefined),
  clearPassword: vi.fn(async () => undefined),
  hasStoredPasswordFlag: vi.fn(() => false),
  getCachedPassword: vi.fn(() => null),
}));

const startMockServer = vi.fn(async () => ({ baseUrl: "http://127.0.0.1:45999", ftpPort: 1, token: "t" }));
const stopMockServer = vi.fn(async () => undefined);
vi.mock("@/lib/mock/mockServer", () => ({
  startMockServer,
  stopMockServer,
  isSimulatedDeviceAvailable: vi.fn(() => true),
  getActiveMockBaseUrl: vi.fn(() => null),
  getActiveMockFtpPort: vi.fn(() => null),
  getActiveMockToken: vi.fn(() => null),
}));

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: () => true,
  getPlatform: () => "android",
}));

vi.mock("@/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: { getNetworkStatus: async () => ({ online: true, supported: true }) },
}));

const loadManager = async (startupMode: string | null) => {
  vi.resetModules();
  if (startupMode) localStorage.setItem("c64u_startup_mode", startupMode);
  const manager = await import("@/lib/connection/connectionManager");
  const states: string[] = [];
  manager.subscribeConnection(() => states.push(manager.getConnectionSnapshot().state));
  return { manager, states };
};

describe("connection manager in SID Player", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    startDeviceDiscovery.mockClear();
    startMockServer.mockClear();
  });

  it("SPM-MODE-01 startup in SID Player settles offline without probing", async () => {
    const { manager, states } = await loadManager("sid-player");
    await manager.initializeConnectionManager();
    await manager.discoverConnection("startup");

    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(states).not.toContain("DISCOVERING");
    expect(states).not.toContain("DEMO_ACTIVE");
    expect(states).not.toContain("REAL_CONNECTED");
    expect(fetch).not.toHaveBeenCalled();
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
  });

  it.each(["startup", "manual", "settings", "switch", "resume"] as const)(
    "SPM-MODE-01 the %s trigger in SID Player sends no probe",
    async (trigger) => {
      const { manager } = await loadManager("sid-player");
      await manager.initializeConnectionManager();
      await manager.discoverConnection(trigger);

      expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
      expect(fetch).not.toHaveBeenCalled();
      expect(startDeviceDiscovery).not.toHaveBeenCalled();
    },
  );

  it("SPM-MODE-01 a background trigger in SID Player does not transition or probe", async () => {
    const { manager, states } = await loadManager("sid-player");
    await manager.initializeConnectionManager();
    await manager.discoverConnection("startup");
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    states.length = 0;

    await manager.discoverConnection("background");

    expect(states).toEqual([]);
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(fetch).not.toHaveBeenCalled();
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
  });

  it("SPM-MODE-01 a returning network in SID Player starts no discovery", async () => {
    const { manager } = await loadManager("sid-player");
    const { reconnectWhenNetworkReturns } = await import("@/lib/connection/networkTransitions");
    await manager.initializeConnectionManager();
    await manager.discoverConnection("startup");
    vi.useFakeTimers();
    const reconnecting = reconnectWhenNetworkReturns();
    await vi.advanceTimersByTimeAsync(20_000);
    await reconnecting;
    vi.useRealTimers();

    expect(fetch).not.toHaveBeenCalled();
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("SPM-ERR-04 SID Player never raises the Demo Mode offer", async () => {
    const { manager } = await loadManager("sid-player");
    await manager.initializeConnectionManager();
    await manager.discoverConnection("startup");
    await manager.discoverConnection("manual");

    expect(manager.getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(startMockServer).not.toHaveBeenCalled();
  });

  it("SPM-MODE-02 pinning Demo Mode is refused while SID Player is active", async () => {
    const { manager } = await loadManager("sid-player");
    await manager.initializeConnectionManager();
    await manager.discoverConnection("startup");
    await manager.pinDemoModeByUserChoice();

    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(manager.isDemoModePinnedByUser()).toBe(false);
    expect(startMockServer).not.toHaveBeenCalled();
  });

  it("SPM-MODE-01 Full App still discovers on startup", async () => {
    const { manager } = await loadManager(null);
    await manager.initializeConnectionManager();
    void manager.discoverConnection("startup");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await manager.transitionToOfflineNoDemo("settings");
  });

  it("SPM-FRST-02 sid-player start-up shows no offer and sends no probe", async () => {
    const { manager } = await loadManager("sid-player");
    const { startForStartupMode } = await import("@/lib/appMode/appModeTransitions");
    await manager.initializeConnectionManager();
    await startForStartupMode();

    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(manager.getConnectionSnapshot().demoInterstitialVisible).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(startDeviceDiscovery).not.toHaveBeenCalled();
  });

  it("SPM-MODE-02 entering SID Player from Demo Mode stops the demo server and clears the Demo pin", async () => {
    const { manager } = await loadManager(null);
    const { enterSidPlayer } = await import("@/lib/appMode/appModeTransitions");
    await manager.initializeConnectionManager();
    await manager.pinDemoModeByUserChoice();
    expect(manager.isDemoModePinnedByUser()).toBe(true);
    stopMockServer.mockClear();

    await enterSidPlayer();

    expect(stopMockServer).toHaveBeenCalled();
    expect(manager.isDemoModePinnedByUser()).toBe(false);
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("SPM-NET-01 entering SID Player ends a discovery that is already running", async () => {
    startDeviceDiscovery.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { candidates: [], scannedHosts: 0, elapsedMs: 300, unsupported: false };
    });
    const { manager } = await loadManager(null);
    const { enterSidPlayer } = await import("@/lib/appMode/appModeTransitions");
    await manager.initializeConnectionManager();
    void manager.discoverConnection("startup");
    await vi.waitFor(() => expect(startDeviceDiscovery).toHaveBeenCalled());
    const requestsBefore = vi.mocked(fetch).mock.calls.length;

    await enterSidPlayer();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(vi.mocked(fetch).mock.calls.length).toBe(requestsBefore);
    expect(startDeviceDiscovery).toHaveBeenCalledTimes(1);
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(manager.getConnectionSnapshot().demoInterstitialVisible).toBe(false);
  });

  it("SPM-MODE-01 a late answer from a device cannot connect the app in SID Player", async () => {
    const { manager, states } = await loadManager("sid-player");
    await manager.initializeConnectionManager();
    await manager.discoverConnection("startup");
    states.length = 0;

    manager.noteReachable("c64u", "rest", { product: "C64 Ultimate", hostname: "c64u" } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(states).not.toContain("REAL_CONNECTED");
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });
});
