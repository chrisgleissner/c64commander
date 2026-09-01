/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isNativePlatform = vi.fn(() => true);
vi.mock("../../../../src/lib/native/platform", () => ({
  isNativePlatform: () => isNativePlatform(),
  getPlatform: () => "android",
}));

const getNetworkStatus = vi.fn();
vi.mock("../../../../src/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: { getNetworkStatus: () => getNetworkStatus() },
}));

const addLog = vi.fn();
vi.mock("../../../../src/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLog(...args),
}));

import {
  isDeviceConfirmedOffline,
  readNativeNetworkStatus,
  shouldStartDemoModeForOfflineDevice,
} from "../../../../src/lib/connection/offlineStartup";

describe("shouldStartDemoModeForOfflineDevice", () => {
  const offlineAndroid = {
    networkStatus: { online: false, supported: true },
    nativePlatform: true,
    realDeviceSessionActive: false,
  };

  it("starts the simulated device when the platform reports no network", () => {
    expect(shouldStartDemoModeForOfflineDevice(offlineAndroid)).toBe(true);
  });

  it("does not start it while the platform reports a network", () => {
    expect(
      shouldStartDemoModeForOfflineDevice({ ...offlineAndroid, networkStatus: { online: true, supported: true } }),
    ).toBe(false);
  });

  it("does not start it when the platform cannot report connectivity", () => {
    expect(
      shouldStartDemoModeForOfflineDevice({ ...offlineAndroid, networkStatus: { online: false, supported: false } }),
    ).toBe(false);
  });

  it("does not start it on a non-native platform", () => {
    expect(shouldStartDemoModeForOfflineDevice({ ...offlineAndroid, nativePlatform: false })).toBe(false);
  });

  it("never replaces a session that has already reached real hardware", () => {
    expect(shouldStartDemoModeForOfflineDevice({ ...offlineAndroid, realDeviceSessionActive: true })).toBe(false);
  });
});

describe("readNativeNetworkStatus", () => {
  beforeEach(() => {
    vi.useRealTimers();
    isNativePlatform.mockReturnValue(true);
    getNetworkStatus.mockReset();
    addLog.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports connectivity as unknown on a non-native platform without calling the bridge", async () => {
    isNativePlatform.mockReturnValue(false);
    await expect(readNativeNetworkStatus()).resolves.toEqual({ online: true, supported: false });
    expect(getNetworkStatus).not.toHaveBeenCalled();
  });

  it("passes the native answer through", async () => {
    getNetworkStatus.mockResolvedValue({ online: false, supported: true });
    await expect(readNativeNetworkStatus()).resolves.toEqual({ online: false, supported: true });
    await expect(isDeviceConfirmedOffline()).resolves.toBe(true);
  });

  it("reports connectivity as unknown when the bridge is missing the method", async () => {
    getNetworkStatus.mockRejectedValue(new Error('Plugin method "getNetworkStatus" is not implemented'));
    await expect(readNativeNetworkStatus()).resolves.toEqual({ online: true, supported: false });
    await expect(isDeviceConfirmedOffline()).resolves.toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Native network status unavailable; treating connectivity as unknown",
      expect.objectContaining({ error: expect.stringContaining("getNetworkStatus") }),
    );
  });

  it("reports connectivity as unknown rather than waiting forever on a bridge that never answers", async () => {
    vi.useFakeTimers();
    getNetworkStatus.mockReturnValue(new Promise(() => {}));
    const pending = readNativeNetworkStatus();
    await vi.advanceTimersByTimeAsync(1600);
    await expect(pending).resolves.toEqual({ online: true, supported: false });
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Native network status timed out; treating connectivity as unknown",
      expect.objectContaining({ timeoutMs: 1500 }),
    );
  });
});

describe("the native network-status test seam", () => {
  type SeamWindow = Window & {
    __c64uTestProbeEnabled?: boolean;
    __c64uMockNetworkStatus?: { online?: boolean; supported?: boolean };
  };

  const seamWindow = () => globalThis.window as SeamWindow;

  beforeEach(() => {
    getNetworkStatus.mockReset();
  });

  afterEach(() => {
    delete seamWindow().__c64uTestProbeEnabled;
    delete seamWindow().__c64uMockNetworkStatus;
  });

  it("is ignored unless the probe opt-in is set, so a stray global cannot change a shipped build", async () => {
    seamWindow().__c64uMockNetworkStatus = { online: false, supported: true };
    getNetworkStatus.mockResolvedValue({ online: true, supported: true });

    await expect(readNativeNetworkStatus()).resolves.toEqual({ online: true, supported: true });
    expect(getNetworkStatus).toHaveBeenCalled();
  });

  it("answers from the injected value and never asks the platform", async () => {
    seamWindow().__c64uTestProbeEnabled = true;
    seamWindow().__c64uMockNetworkStatus = { online: true, supported: true };
    getNetworkStatus.mockResolvedValue({ online: false, supported: true });

    // "A network is up but no C64U answers" cannot be staged on the bench handset without putting
    // probe traffic on the Wi-Fi the real devices are on. This is what lets a hardware run take
    // the network-enabled route with the radios off.
    await expect(readNativeNetworkStatus()).resolves.toEqual({ online: true, supported: true });
    expect(getNetworkStatus).not.toHaveBeenCalled();
    await expect(isDeviceConfirmedOffline()).resolves.toBe(false);
  });

  it("can also assert no network, which is the offline auto-offer case", async () => {
    seamWindow().__c64uTestProbeEnabled = true;
    seamWindow().__c64uMockNetworkStatus = { online: false, supported: true };

    await expect(isDeviceConfirmedOffline()).resolves.toBe(true);
  });
});
