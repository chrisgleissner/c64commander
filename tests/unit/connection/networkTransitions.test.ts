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
 * Only the platform edges are replaced: the phone's network state, which the tests switch the way
 * Android reports it, and the Live View session, which has no receiver in a test process.
 */

let networkOnline = true;
let networkListener: ((status: { online: boolean; supported: boolean }) => void) | null = null;
const nativeListener = vi.hoisted(() => ({
  mode: "ready" as "ready" | "throws" | "pending",
  removed: 0,
  release: () => {},
}));
vi.mock("../../../src/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: {
    getNetworkStatus: async () => ({ online: networkOnline, supported: true }),
    addListener: (_event: string, listener: (status: { online: boolean; supported: boolean }) => void) => {
      if (nativeListener.mode === "throws") throw new Error("plugin not implemented");
      const handle = {
        remove: async () => {
          nativeListener.removed += 1;
        },
      };
      if (nativeListener.mode === "pending") {
        return new Promise((resolve) => {
          nativeListener.release = () => resolve(handle);
        });
      }
      networkListener = listener;
      return Promise.resolve(handle);
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

const mirror = vi.hoisted(() => {
  type Listener = (snapshot: { video: { state: string }; audio: { state: string } }) => void;
  const listeners = new Set<Listener>();
  const state = { video: "off", audio: "off" };
  const emit = () =>
    listeners.forEach((listener) => listener({ video: { state: state.video }, audio: { state: state.audio } }));
  return {
    state,
    emit,
    session: {
      subscribe: (listener: Listener) => {
        listeners.add(listener);
        listener({ video: { state: state.video }, audio: { state: state.audio } });
        return () => listeners.delete(listener);
      },
      get videoLive() {
        return state.video === "live";
      },
      get audioLive() {
        return state.audio === "live";
      },
      stopAll: async () => {
        state.video = "off";
        state.audio = "off";
        emit();
      },
      startVideo: async () => {
        state.video = "live";
        emit();
      },
      startAudio: async () => {
        state.audio = "live";
        emit();
      },
    },
  };
});
vi.mock("../../../src/lib/streams/avMirrorSession", () => ({ avMirrorSession: mirror.session }));

const leftoverStreams = vi.hoisted(() => ({ stop: vi.fn(async () => undefined) }));
vi.mock("../../../src/lib/streams/leftoverDeviceStreams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/streams/leftoverDeviceStreams")>()),
  stopLeftoverDeviceStreams: () => leftoverStreams.stop(),
}));

const retarget = vi.hoisted(() => ({ restart: vi.fn() }));
vi.mock("../../../src/lib/connection/deviceRetarget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/connection/deviceRetarget")>();
  return {
    ...actual,
    restartAvMirrorAfterDeviceRetarget: (...args: Parameters<typeof actual.restartAvMirrorAfterDeviceRetarget>) => {
      retarget.restart(...args);
      actual.restartAvMirrorAfterDeviceRetarget(...args);
    },
  };
});

const phonePlayback = vi.hoisted(() => ({ active: false }));
vi.mock("../../../src/lib/playback/activePlaybackSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/playback/activePlaybackSession")>()),
  isLocalPlaybackActive: () => phonePlayback.active,
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
    nativeListener.mode = "ready";
    nativeListener.removed = 0;
    mirror.state.video = "off";
    mirror.state.audio = "off";
    phonePlayback.active = false;
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

  it("puts Live View back on after the outage it was switched off for", async () => {
    const { manager } = await connect();
    mirror.state.video = "live";
    mirror.emit();

    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    await vi.waitFor(() => expect(mirror.state.video).toBe("off"));

    setNetwork(true);
    await vi.waitFor(() => expect(mirror.state.video).toBe("live"), { timeout: 2000 });
    // With the identity of the device that answered, so Live View is not started on one that cannot stream.
    expect(retarget.restart).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ product: "C64 Ultimate", core_version: "1.0.0" }),
    );
  });

  it("counts Live View as on when its stream closed with the network a moment before the event", async () => {
    const { manager } = await connect();
    mirror.state.video = "live";
    mirror.emit();
    // The receiver socket closes as the interface goes away, ahead of the connectivity callback.
    mirror.state.video = "off";
    mirror.emit();

    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    setNetwork(true);

    await vi.waitFor(() => expect(mirror.state.video).toBe("live"), { timeout: 2000 });
  });

  it("leaves Live View off after an outage when the user had turned it off", async () => {
    const { manager } = await connect();

    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    setNetwork(true);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED"), { timeout: 2000 });

    expect(mirror.state.video).toBe("off");
  });

  it("shows the device offline without probing it when a request fails after the network has gone", async () => {
    const { manager, transitions } = await connect();
    // The network status is known before the transitions hear of it: the request failure arrives first.
    uninstall?.();
    uninstall = null;
    const requestsBefore = server.requests.length;
    setNetwork(false);

    await transitions.confirmDeviceUnreachable();

    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(server.requests.length).toBe(requestsBefore);
  });

  it("stops confirming when the device is shown offline for another reason in the meantime", async () => {
    const { manager, transitions } = await connect();
    server.setFaultMode("refused");

    const confirming = transitions.confirmDeviceUnreachable();
    await manager.noteDeviceUnreachable("network-lost");
    await confirming;
    const requestsAfter = server.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 2500));

    expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO");
    expect(server.requests.length).toBe(requestsAfter);
  });

  it("does nothing on return to the foreground while still connected, or while hidden", async () => {
    const { manager } = await connect();
    const requestsBefore = server.requests.length;
    const visibility = vi.spyOn(document, "visibilityState", "get");

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(server.requests.length).toBe(requestsBefore);
    visibility.mockRestore();
  });

  it("stops reconnecting once the device is connected again", async () => {
    const { manager, transitions } = await connect();
    const requestsBefore = server.requests.length;

    await transitions.reconnectWhenNetworkReturns();

    expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED");
    expect(server.requests.length).toBe(requestsBefore);
  });

  it("confirms an unanswered request reported by the API before showing the device offline", async () => {
    const { manager } = await connect();
    const events = await import("../../../src/lib/connection/reachabilityEvents");

    server.setFaultMode("refused");
    events.notifyUnreachable(hostOf(server.baseUrl), "rest");

    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"), { timeout: 5000 });
  });

  it("reconnects on return to the foreground when the network came back while the app was hidden", async () => {
    const { manager } = await connect();
    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));

    // The listener did not run while hidden, so only the foreground read can learn the network is back.
    networkOnline = true;
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("REAL_CONNECTED"), { timeout: 2000 });
  });

  it("puts Live View sound back on after an outage as well as the picture", async () => {
    const { manager } = await connect();
    mirror.state.audio = "live";
    mirror.emit();

    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    await vi.waitFor(() => expect(mirror.state.audio).toBe("off"));

    setNetwork(true);
    await vi.waitFor(() => expect(mirror.state.audio).toBe("live"), { timeout: 2000 });
  });

  it("brings the picture back but not the sound while a tune that carried on on the phone is playing", async () => {
    const { manager } = await connect();
    mirror.state.video = "live";
    mirror.state.audio = "live";
    mirror.emit();
    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    await vi.waitFor(() => expect(mirror.state.audio).toBe("off"));
    phonePlayback.active = true;

    setNetwork(true);

    await vi.waitFor(() => expect(mirror.state.video).toBe("live"), { timeout: 2000 });
    expect(mirror.state.audio).toBe("off");
  });

  it("brings back Live View that was kept off while the device was out of reach once the device answers", async () => {
    const { manager, transitions } = await connect();
    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    transitions.restoreMirrorWhenDeviceReturns({ videoWasLive: true, audioWasLive: false });

    setNetwork(true);

    await vi.waitFor(() => expect(mirror.state.video).toBe("live"), { timeout: 2000 });
  });

  // Leaving home with Live View's sound on: the stop could not reach the c64u, which then streamed into the
  // multicast group until another device's Live View found it there.
  it("stops the streams the device was left sending once it answers again, before Live View restarts", async () => {
    const { manager } = await connect();
    mirror.state.audio = "live";
    mirror.emit();
    setNetwork(false);
    await vi.waitFor(() => expect(manager.getConnectionSnapshot().state).toBe("OFFLINE_NO_DEMO"));
    await vi.waitFor(() => expect(mirror.state.audio).toBe("off"));
    leftoverStreams.stop.mockClear();
    let audioAtSweep = "";
    leftoverStreams.stop.mockImplementation(async () => {
      audioAtSweep = mirror.state.audio;
    });

    setNetwork(true);

    await vi.waitFor(() => expect(mirror.state.audio).toBe("live"), { timeout: 2000 });
    expect(leftoverStreams.stop).toHaveBeenCalledTimes(1);
    expect(audioAtSweep).toBe("off");
  });

  it("relies on background probes when the platform cannot report network changes", async () => {
    const logging = await import("../../../src/lib/logging");
    const addLog = vi.spyOn(logging, "addLog");
    nativeListener.mode = "throws";
    const transitions = await import("../../../src/lib/connection/networkTransitions");

    uninstall = transitions.installNetworkTransitions();

    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Network change events are unavailable; reconnection relies on background probes",
      { error: "plugin not implemented" },
    );
    addLog.mockRestore();
  });

  it("removes a network listener that arrives after the transitions were uninstalled", async () => {
    nativeListener.mode = "pending";
    const transitions = await import("../../../src/lib/connection/networkTransitions");

    transitions.installNetworkTransitions()();
    nativeListener.release();

    await vi.waitFor(() => expect(nativeListener.removed).toBe(1));
  });
});
