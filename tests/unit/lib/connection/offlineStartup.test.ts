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
