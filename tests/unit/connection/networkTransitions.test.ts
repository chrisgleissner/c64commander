/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockC64Server, type MockC64Server } from "../../mocks/mockC64Server";

/*
 * The connection manager and the network transitions run for real against the shared fake Ultimate.
 * Only the platform edge is replaced: the phone's network state, which the tests switch the way
 * Android reports it.
 */

let networkOnline = true;
let networkListener: ((status: { online: boolean; supported: boolean }) => void) | null = null;
vi.mock("../../../src/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: {
    getNetworkStatus: async () => ({ online: networkOnline, supported: true }),
    addListener: async (_event: string, listener: (status: { online: boolean; supported: boolean }) => void) => {
      networkListener = listener;
      return { remove: async () => undefined };
    },
    discover: async () => ({ candidates: [], scannedHosts: 0, elapsedMs: 0 }),
  },
}));

vi.mock("../../../src/lib/native/platform", () => ({
  isNativePlatform: () => true,
  getPlatform: () => "android",
}));

vi.mock("../../../src/lib/deviceDiscovery/discoveryManager", () => ({
  startDeviceDiscovery: vi.fn(async () => ({ candidates: [], scannedHosts: 0, elapsedMs: 0, unsupported: false })),
  persistDiscoveredDevice: vi.fn(),
  getDeviceDiscoveryState: () => ({ phase: "idle", candidates: [], acknowledged: false, trigger: null }),
  subscribeDeviceDiscovery: () => () => undefined,
}));

vi.mock("../../../src/lib/config/featureFlags", () => ({
  featureFlagManager: {
    load: vi.fn(async () => undefined),
    getSnapshot: () => ({ flags: { demo_mode_enabled: false } }),
  },
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

const hostOf = (baseUrl: string) => new URL(baseUrl).host;

const setNetwork = (online: boolean) => {
  networkOnline = online;
  networkListener?.({ online, supported: true });
};

describe("following the phone on and off its network", () => {
  let server: MockC64Server;
  let uninstall: (() => void) | null = null;

  beforeAll(async () => {
    server = await createMockC64Server();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    networkOnline = true;
    networkListener = null;
    server.setReachable(true);
    server.setFaultMode("none");
    localStorage.setItem("c64u_device_host", hostOf(server.baseUrl));
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  const connect = async () => {
    const manager = await import("../../../src/lib/connection/connectionManager");
    const transitions = await import("../../../src/lib/connection/networkTransitions");
    const watch = await import("../../../src/lib/connection/networkStatusWatch");
    watch.resetNetworkStatusWatchForTests();
    await manager.initializeConnectionManager();
    uninstall = transitions.installNetworkTransitions();
    await vi.waitFor(() => expect(networkListener).not.toBeNull());
    await manager.discoverConnection("startup");
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED"), { timeout: 5000 });
    return { manager, transitions, watch };
  };

  it("shows the device offline the moment the network goes, without asking the device first", async () => {
    const { manager } = await connect();
    const requestsBefore = server.requests.length;

    setNetwork(false);

    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    expect(server.requests.length).toBe(requestsBefore);
  });

  it("reconnects when the network returns rather than at the next background probe", async () => {
    const { manager } = await connect();
    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));

    const returnedAt = Date.now();
    setNetwork(true);

    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED"), { timeout: 2000 });
    // The background schedule's first tick is 5 s away; this has to come from the network event.
    expect(Date.now() - returnedAt).toBeLessThan(2000);
  });

  it("keeps trying while the returning Wi-Fi cannot reach the device yet", async () => {
    const { manager } = await connect();
    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));

    server.setFaultMode("refused");
    setNetwork(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    server.setFaultMode("none");

    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED"), { timeout: 4000 });
  });

  it("confirms that a device on a working network has stopped answering before showing it offline", async () => {
    const { manager, transitions } = await connect();

    server.setFaultMode("refused");
    const confirming = transitions.confirmDeviceUnreachable();
    expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    await confirming;

    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
  });

  it("stays connected when the confirming probe gets an answer", async () => {
    const { manager, transitions } = await connect();

    await transitions.confirmDeviceUnreachable();

    expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED");
  });
});
