/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({
  oldReset: vi.fn(),
  retryReset: vi.fn(),
  selectedDeviceId: "old-device",
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ machineReset: device.oldReset }),
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u", password: undefined }),
  C64API: class {
    machineReset = device.retryReset;
  },
}));
vi.mock("@/lib/savedDevices/store", () => ({
  getSavedDevicesSnapshot: () => ({ selectedDeviceId: device.selectedDeviceId }),
}));
vi.mock("@/lib/savedDevices/sameDevice", () => ({ areSavedEntriesSameDevice: () => false }));
vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  getSharedLocalSidPlaybackController: () => ({ stop: vi.fn(), isActive: () => false }),
}));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import {
  isRemotePlaybackActive,
  markRemotePlaybackStarted,
  stopActivePlaybackBeforeDeviceSwitch,
} from "@/lib/playback/activePlaybackSession";

describe("stopping the old device's tune before a device switch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    device.oldReset.mockReset();
    device.retryReset.mockReset().mockResolvedValue(undefined);
    device.selectedDeviceId = "old-device";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets the device left behind again when its reset is not confirmed before the switch timeout", async () => {
    device.oldReset.mockReturnValue(new Promise(() => undefined));
    markRemotePlaybackStarted();

    const switching = stopActivePlaybackBeforeDeviceSwitch(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await switching;
    expect(isRemotePlaybackActive()).toBe(false);

    device.selectedDeviceId = "new-device";
    await vi.advanceTimersByTimeAsync(1000);
    expect(device.retryReset).toHaveBeenCalledTimes(1);
  });

  it("does not reset again when the old device confirms its reset in time", async () => {
    device.oldReset.mockResolvedValue(undefined);
    markRemotePlaybackStarted();

    await stopActivePlaybackBeforeDeviceSwitch(2000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(device.retryReset).not.toHaveBeenCalled();
  });
});
