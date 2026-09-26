/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({
  activeReset: vi.fn(async () => ({ errors: [] as string[] })),
  leftBehindReset: vi.fn(async () => ({ errors: [] as string[] })),
  leftBehindHosts: [] as string[],
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({ machineReset: device.activeReset }),
  getC64APIConfigSnapshot: () => ({ deviceHost: "c64u", password: "secret", baseUrl: "http://c64u" }),
  C64API: class {
    constructor(_baseUrl: string, _password: string | undefined, deviceHost: string) {
      device.leftBehindHosts.push(deviceHost);
    }
    machineReset = device.leftBehindReset;
  },
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  getSharedLocalSidPlaybackController: () => ({ isActive: () => false, stop: vi.fn() }),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  addSavedDevice,
  completeSavedDeviceVerification,
  getSavedDevicesSnapshot,
  selectSavedDevice,
} from "@/lib/savedDevices/store";
import {
  isRemotePlaybackActive,
  markRemotePlaybackStarted,
  stopActivePlaybackBeforeDeviceSwitch,
} from "@/lib/playback/activePlaybackSession";

describe("stopping the tune on the device a switch leaves", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    device.activeReset.mockReset();
    device.leftBehindReset.mockReset();
    device.leftBehindReset.mockResolvedValue({ errors: [] });
    device.leftBehindHosts.length = 0;
    vi.mocked(addLog).mockClear();
    markRemotePlaybackStarted();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // On a Pixel 4 the c64u once took over 1.5 s to answer; the switch went ahead with the C64 still playing.
  it("sends the reset again to that device when it did not answer in time, without a warning", async () => {
    device.activeReset.mockRejectedValueOnce(new Error("Host unreachable"));

    await stopActivePlaybackBeforeDeviceSwitch();

    expect(isRemotePlaybackActive()).toBe(false);
    expect(addLog).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
    await vi.advanceTimersByTimeAsync(1000);
    expect(device.leftBehindHosts).toEqual(["c64u"]);
    expect(device.leftBehindReset).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith("info", "Playback: reset the device left behind by the switch", {
      service: "playback",
      deviceHost: "c64u",
    });
  });

  // A switch to the same Ultimate's other address leaves no device behind: resetting "the old
  // host" would stop the tune the user now controls through the new address.
  it("does not reset the device left behind when the switch selected the same device at another address", async () => {
    const leftBehindId = getSavedDevicesSnapshot().selectedDeviceId;
    completeSavedDeviceVerification(leftBehindId, { product: "Ultimate 64 Elite", unique_id: "DUAL01" });
    addSavedDevice({
      id: "same-device-other-address",
      name: "Desk wired",
      host: "192.0.2.10",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "U64E",
      lastKnownHostname: "ultimate",
      lastKnownUniqueId: "DUAL01",
      hasPassword: false,
    });
    device.activeReset.mockRejectedValueOnce(new Error("Host unreachable"));

    await stopActivePlaybackBeforeDeviceSwitch();
    selectSavedDevice("same-device-other-address");
    await vi.advanceTimersByTimeAsync(4000);

    expect(device.leftBehindReset).not.toHaveBeenCalled();
    selectSavedDevice(leftBehindId);
  });

  it("warns only when the device left behind answers none of the resets", async () => {
    device.activeReset.mockRejectedValueOnce(new Error("Host unreachable"));
    device.leftBehindReset.mockRejectedValue("Host unreachable");

    await stopActivePlaybackBeforeDeviceSwitch();
    await vi.advanceTimersByTimeAsync(4000);

    expect(device.leftBehindReset).toHaveBeenCalledTimes(2);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Playback: could not stop the tune on the device left behind by the switch",
      expect.objectContaining({ deviceHost: "c64u" }),
    );
  });

  it("does not reset again when the device answered", async () => {
    await stopActivePlaybackBeforeDeviceSwitch();
    await vi.advanceTimersByTimeAsync(4000);

    expect(device.activeReset).toHaveBeenCalledTimes(1);
    expect(device.leftBehindReset).not.toHaveBeenCalled();
  });
});
