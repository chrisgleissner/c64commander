/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/streams/foreignSenderStop", () => ({
  stopStreamAtHost: vi.fn(async () => ({ errors: [] })),
  stopStreamAtForeignHost: vi.fn(async () => ({ errors: [] })),
  resolveForeignSenderPassword: vi.fn(async () => null),
}));

const networkStatus = vi.hoisted(() => ({ current: { online: true, supported: false } }));
vi.mock("@/lib/connection/offlineStartup", () => ({
  readNativeNetworkStatus: vi.fn(async () => networkStatus.current),
}));

vi.mock("@/lib/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logging")>();
  return { ...actual, addLog: vi.fn(actual.addLog) };
});

import { stopStreamAtHost } from "@/lib/streams/foreignSenderStop";
import { addLog } from "@/lib/logging";
import { recordNetworkStatus, resetNetworkStatusWatchForTests } from "@/lib/connection/networkStatusWatch";
import {
  getLeftoverDeviceStreamsForTests,
  recordDeviceStreamStarted,
  recordDeviceStreamStopped,
  stopLeftoverDeviceStreams,
} from "@/lib/streams/leftoverDeviceStreams";

/**
 * HARD27-021. `streams:start` puts the firmware into a state only `streams:stop` leaves. If Android
 * kills the process with Live View on, the stop never runs and the Ultimate keeps multicasting.
 * The firmware exposes no way to ask what it is streaming, so the app has to remember.
 */
describe("leftover device streams (HARD27-021)", () => {
  const stopAt = vi.mocked(stopStreamAtHost);

  beforeEach(() => {
    localStorage.clear();
    stopAt.mockClear();
    stopAt.mockResolvedValue({ errors: [] });
    vi.mocked(addLog).mockClear();
    networkStatus.current = { online: true, supported: false };
    resetNetworkStatusWatchForTests();
  });

  // The simulated device runs inside the app and dies with it; a record of its loopback address made
  // every launch after a Demo Mode Live View log a failed stop against a server that no longer exists.
  it("does not record a stream started on the in-app simulated device", () => {
    recordDeviceStreamStarted("video", "127.0.0.1:43439");
    recordDeviceStreamStarted("audio", "localhost:43439");

    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("drops a loopback record left by an older build without sending a stop", async () => {
    localStorage.setItem("c64u_device_streams_running", JSON.stringify({ video: "127.0.0.1:43439" }));

    await stopLeftoverDeviceStreams();

    expect(stopAt).not.toHaveBeenCalled();
    expect(localStorage.getItem("c64u_device_streams_running")).toBeNull();
  });

  it("waits for a network before stopping streams left running, instead of failing at an offline launch", async () => {
    recordDeviceStreamStarted("video", "192.168.1.146");
    networkStatus.current = { online: false, supported: true };
    recordNetworkStatus(networkStatus.current);

    await stopLeftoverDeviceStreams();

    expect(stopAt).not.toHaveBeenCalled();
    expect(getLeftoverDeviceStreamsForTests()).toEqual({ video: "192.168.1.146" });

    networkStatus.current = { online: true, supported: true };
    recordNetworkStatus(networkStatus.current);

    await vi.waitFor(() => expect(stopAt).toHaveBeenCalledWith("192.168.1.146", "video"));
    await vi.waitFor(() => expect(getLeftoverDeviceStreamsForTests()).toEqual({}));
    await vi.waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "info",
        "Live View: stopped the video stream left running on the device",
        expect.objectContaining({ host: "192.168.1.146" }),
      ),
    );
  });

  it("keeps waiting through another offline report, and warns about a stop the device refused", async () => {
    recordDeviceStreamStarted("audio", "192.168.1.146");
    // The platform answered "no network" just before the watch last heard the network was up.
    recordNetworkStatus({ online: true, supported: true });
    networkStatus.current = { online: false, supported: true };
    await stopLeftoverDeviceStreams();

    recordNetworkStatus({ online: false, supported: true });
    expect(stopAt).not.toHaveBeenCalled();
    stopAt.mockRejectedValue("stream is busy");
    networkStatus.current = { online: true, supported: true };
    recordNetworkStatus(networkStatus.current);

    await vi.waitFor(() =>
      expect(vi.mocked(addLog)).toHaveBeenCalledWith(
        "warn",
        "Live View: could not stop the audio stream left running on the device",
        expect.objectContaining({ host: "192.168.1.146", error: "stream is busy" }),
      ),
    );
  });

  it("logs a stop that could not reach the device at info, because a device with no power streams nothing", async () => {
    recordDeviceStreamStarted("video", "192.168.1.146");
    stopAt.mockRejectedValue(new Error("Failed to connect to /192.168.1.146:80"));

    await stopLeftoverDeviceStreams();

    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "info",
      "Live View: could not stop the video stream left running on the device",
      expect.objectContaining({ host: "192.168.1.146" }),
    );
    expect(vi.mocked(addLog)).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
  });

  it("remembers the host a stream was started on and forgets it when the stop succeeds", () => {
    recordDeviceStreamStarted("video", "192.168.1.10");
    recordDeviceStreamStarted("audio", "192.168.1.10");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({ audio: "192.168.1.10", video: "192.168.1.10" });

    recordDeviceStreamStopped("video");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({ audio: "192.168.1.10" });

    recordDeviceStreamStopped("audio");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("stops both streams at the recorded host on the next launch and clears the record", async () => {
    recordDeviceStreamStarted("audio", "192.168.1.10");
    recordDeviceStreamStarted("video", "192.168.1.10");

    await stopLeftoverDeviceStreams();

    expect(stopAt).toHaveBeenCalledTimes(2);
    expect(stopAt).toHaveBeenCalledWith("192.168.1.10", "audio");
    expect(stopAt).toHaveBeenCalledWith("192.168.1.10", "video");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("issues nothing when the previous session stopped its streams cleanly", async () => {
    recordDeviceStreamStarted("video", "192.168.1.10");
    recordDeviceStreamStopped("video");

    await stopLeftoverDeviceStreams();

    expect(stopAt).not.toHaveBeenCalled();
  });

  it("clears the record even when the device cannot be reached, so it is not retried forever", async () => {
    recordDeviceStreamStarted("video", "192.168.1.10");
    stopAt.mockRejectedValue(new Error("timeout"));

    await expect(stopLeftoverDeviceStreams()).resolves.toBeUndefined();

    expect(stopAt).toHaveBeenCalledTimes(1);
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("keeps the record when the stop failed, because the device may still be streaming", () => {
    recordDeviceStreamStarted("video", "192.168.1.10");
    // recordDeviceStreamStopped is only reached after a successful stop; a thrown stop skips it.
    expect(getLeftoverDeviceStreamsForTests()).toEqual({ video: "192.168.1.10" });
  });

  it("ignores a start with no resolvable host", () => {
    recordDeviceStreamStarted("video", null);
    recordDeviceStreamStarted("audio", "   ");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("survives a corrupt record without throwing, and warns that the sweep cannot run", async () => {
    localStorage.setItem("c64u_device_streams_running", "{not json");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
    await expect(stopLeftoverDeviceStreams()).resolves.toBeUndefined();
    expect(stopAt).not.toHaveBeenCalled();
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "Live View: could not read the record of device streams left running",
      expect.objectContaining({ service: "streams" }),
    );
  });

  // A record that was not written is a sweep that will not happen, but it must never break the
  // start or stop it was riding on.
  it("keeps going when localStorage refuses the record, and warns that the sweep will not happen", () => {
    // Scoped to this key: the failure handler logs, and the logger uses localStorage too.
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "c64u_device_streams_running") throw new DOMException("quota", "QuotaExceededError");
      realSetItem.call(this, key, value);
    });
    try {
      expect(() => recordDeviceStreamStarted("video", "192.168.1.148")).not.toThrow();
    } finally {
      setItem.mockRestore();
    }

    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "Live View: could not record which device streams are running",
      expect.objectContaining({ service: "streams", error: expect.stringContaining("quota") }),
    );
  });

  it("keeps going when localStorage refuses to be read", () => {
    const realGetItem = Storage.prototype.getItem;
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === "c64u_device_streams_running") throw new DOMException("denied", "SecurityError");
      return realGetItem.call(this, key);
    });
    try {
      expect(getLeftoverDeviceStreamsForTests()).toEqual({});
    } finally {
      getItem.mockRestore();
    }
  });

  it("ignores a stored record that is not an object", () => {
    localStorage.setItem("c64u_device_streams_running", '"not-an-object"');

    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
  });

  it("removes the record entirely once nothing is left running", () => {
    recordDeviceStreamStarted("audio", "192.168.1.148");
    recordDeviceStreamStopped("audio");

    expect(localStorage.getItem("c64u_device_streams_running")).toBeNull();
  });
});
