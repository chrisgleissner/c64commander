/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const connection = vi.hoisted(() => ({
  discoverConnection: vi.fn(),
  getConnectionSnapshot: vi.fn(() => ({ state: "REAL_CONNECTED" })),
  pinDemoModeByUserChoice: vi.fn(),
  transitionToOfflineNoDemo: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", () => connection);

const discovery = vi.hoisted(() => ({ discardDeviceDiscovery: vi.fn() }));

vi.mock("@/lib/deviceDiscovery/discoveryManager", () => discovery);

const load = async () => {
  vi.resetModules();
  const store = await import("@/lib/appMode/appModeStore");
  const transitions = await import("@/lib/appMode/appModeTransitions");
  return { store, transitions };
};

describe("app mode transitions", () => {
  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    discovery.discardDeviceDiscovery.mockReset();
    connection.discoverConnection.mockReset().mockImplementation(async (trigger: string) => {
      calls.push(`discover:${trigger}`);
    });
    connection.pinDemoModeByUserChoice.mockReset().mockImplementation(async () => {
      calls.push("pin");
    });
    connection.transitionToOfflineNoDemo.mockReset().mockImplementation(async (trigger: string) => {
      calls.push(`offline:${trigger}`);
    });
  });

  it("SPM-MODE-02 a release handler runs against the device before the mode is saved and the gate closes", async () => {
    const { store, transitions } = await load();
    const release = await import("@/lib/appMode/deviceRelease");
    const gate = await import("@/lib/appMode/deviceTrafficGate");
    release.registerDeviceRelease(async () => {
      calls.push(`release while sid-player=${store.isSidPlayerActive()}`);
      gate.assertDeviceTrafficAllowed("rest", { path: "/v1/machine:reset" });
    });
    await transitions.enterSidPlayer();
    expect(calls).toEqual(["release while sid-player=false", "offline:settings"]);
    expect(() => gate.assertDeviceTrafficAllowed("rest")).toThrow(/blocked device traffic/);
  });

  it("SPM-NET-01 entering SID Player discards a device scan that is still in flight", async () => {
    const { transitions } = await load();
    await transitions.enterSidPlayer();
    expect(discovery.discardDeviceDiscovery).toHaveBeenCalledTimes(1);
  });

  it("SPM-MODE-02 nothing is released when no device is connected", async () => {
    const { transitions } = await load();
    connection.getConnectionSnapshot.mockReturnValue({ state: "OFFLINE_NO_DEMO" });
    const release = await import("@/lib/appMode/deviceRelease");
    const handler = vi.fn(async () => undefined);
    release.registerDeviceRelease(handler);
    await transitions.enterSidPlayer();
    expect(handler).not.toHaveBeenCalled();
  });

  it("SPM-MODE-02 a release handler that never answers cannot hold the switch open", async () => {
    vi.useFakeTimers();
    try {
      const { store, transitions } = await load();
      const release = await import("@/lib/appMode/deviceRelease");
      release.registerDeviceRelease(() => new Promise<void>(() => undefined));
      const entering = transitions.enterSidPlayer();
      await vi.advanceTimersByTimeAsync(4500);
      await entering;
      expect(store.isSidPlayerActive()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("SPM-NAV-04 entering sets the Back baseline and switching to the Full App clears it", async () => {
    const { transitions } = await load();
    const back = await import("@/lib/navigation/navigateBack");
    window.history.replaceState({ idx: 3 }, "");
    const navigate = vi.fn();

    await transitions.enterSidPlayer();
    back.navigateBackOrLeave(navigate);
    expect(navigate).not.toHaveBeenCalled();

    await transitions.switchToFullApp();
    back.navigateBackOrLeave(navigate);
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it("SPM-MODE-02 entering SID Player persists the mode and settles the connection offline", async () => {
    const { store, transitions } = await load();
    await transitions.enterSidPlayer();
    expect(store.isSidPlayerActive()).toBe(true);
    expect(localStorage.getItem("c64u_startup_mode")).toBe("sid-player");
    expect(calls).toEqual(["offline:settings"]);
  });

  it("SPM-MODE-02 entering Demo Mode from SID Player switches to Full App first, then pins Demo Mode", async () => {
    const { store, transitions } = await load();
    store.saveStartupModeByUser("sid-player");
    connection.pinDemoModeByUserChoice.mockImplementation(async () => {
      calls.push(`pin while sid-player=${store.isSidPlayerActive()}`);
    });
    await transitions.switchToDemoMode();
    expect(calls).toEqual(["pin while sid-player=false"]);
    expect(localStorage.getItem("c64u_startup_mode")).toBe("default");
  });

  it("SPM-SWT-02 leaving to Full App persists the default mode and starts settings discovery", async () => {
    const { store, transitions } = await load();
    store.saveStartupModeByUser("sid-player");
    await transitions.switchToFullApp();
    expect(store.isSidPlayerActive()).toBe(false);
    expect(localStorage.getItem("c64u_startup_mode")).toBe("default");
    expect(calls).toEqual(["discover:settings"]);
  });

  it("SPM-MODE-04 a round trip through SID Player leaves every other stored key unchanged", async () => {
    localStorage.setItem("c64u_playlist", "[1,2]");
    localStorage.setItem("c64u_saved_devices", '{"devices":[]}');
    localStorage.setItem("c64u_feature_overrides", "{}");
    const { transitions } = await load();
    const before = { ...localStorage };
    await transitions.enterSidPlayer();
    await transitions.switchToFullApp();
    const after = { ...localStorage };
    expect(after.c64u_startup_mode).toBe("default");
    delete after.c64u_startup_mode;
    expect(after).toEqual(before);
  });
});
