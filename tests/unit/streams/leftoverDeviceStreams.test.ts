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

import { stopStreamAtHost } from "@/lib/streams/foreignSenderStop";
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

  it("survives a corrupt record without throwing", async () => {
    localStorage.setItem("c64u_device_streams_running", "{not json");
    expect(getLeftoverDeviceStreamsForTests()).toEqual({});
    await expect(stopLeftoverDeviceStreams()).resolves.toBeUndefined();
    expect(stopAt).not.toHaveBeenCalled();
  });

  // A record that was not written is a sweep that will not happen, but it must never break the
  // start or stop it was riding on.
  it("keeps going when localStorage refuses the record", () => {
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
