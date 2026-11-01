/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED" }));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => ({ state: connection.state }),
}));

const inputRelease = vi.hoisted(() => ({
  active: false,
  release: vi.fn(async () => undefined),
}));
vi.mock("@/lib/remoteInput/activeInputRelease", () => ({
  hasActiveInputRelease: () => inputRelease.active,
  releaseActiveRemoteInput: inputRelease.release,
}));

const liveView = vi.hoisted(() => ({
  needsStop: false,
  stop: vi.fn(async () => undefined),
}));
vi.mock("@/lib/connection/deviceRetarget", () => ({
  readAvMirrorRetargetState: () => ({}),
  avMirrorNeedsStop: () => liveView.needsStop,
  stopAvMirrorForDeviceRetarget: liveView.stop,
}));

const logging = vi.hoisted(() => ({ addLog: vi.fn() }));
vi.mock("@/lib/logging", () => logging);

import {
  DEVICE_RELEASE_TIMEOUT_MS,
  isReleasingDevice,
  registerDeviceRelease,
  releaseDeviceForSidPlayer,
  untilAborted,
} from "@/lib/appMode/deviceRelease";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";

describe("releasing the device for SID Player", () => {
  beforeEach(() => {
    connection.state = "REAL_CONNECTED";
    inputRelease.active = false;
    liveView.needsStop = false;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("SPM-MODE-02 steps run side by side under one bound, so a hanging device costs the bound once", async () => {
    const unregister = [
      registerDeviceRelease(() => new Promise<void>(() => undefined)),
      registerDeviceRelease(() => new Promise<void>(() => undefined)),
    ];
    const started = Date.now();
    const releasing = releaseDeviceForSidPlayer();
    await vi.advanceTimersByTimeAsync(DEVICE_RELEASE_TIMEOUT_MS + 100);
    await releasing;

    expect(Date.now() - started).toBeLessThan(DEVICE_RELEASE_TIMEOUT_MS + 500);
    expect(isReleasingDevice()).toBe(false);
    unregister.forEach((remove) => remove());
  });

  it("SPM-MODE-02 a late task is told to stop when the release is abandoned", async () => {
    let seen: AbortSignal | null = null;
    const remove = registerDeviceRelease((signal) => {
      seen = signal;
      return new Promise<void>(() => undefined);
    });
    const releasing = releaseDeviceForSidPlayer();
    await vi.advanceTimersByTimeAsync(DEVICE_RELEASE_TIMEOUT_MS + 100);
    await releasing;

    expect((seen as AbortSignal | null)?.aborted).toBe(true);
    remove();
  });

  it("SPM-MODE-02 a second request while one runs waits for the same release", async () => {
    const handler = vi.fn(async () => undefined);
    const remove = registerDeviceRelease(handler);
    const first = releaseDeviceForSidPlayer();
    const second = releaseDeviceForSidPlayer();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(1);
    remove();
  });

  it("SPM-MODE-02 held Remote Input is released when entering SID Player", async () => {
    inputRelease.active = true;
    const releasing = releaseDeviceForSidPlayer();
    await vi.advanceTimersByTimeAsync(10);
    await releasing;

    expect(inputRelease.release).toHaveBeenCalledTimes(1);
    expect(liveView.stop).not.toHaveBeenCalled();
  });

  it("SPM-MODE-02 a running Live View is stopped when entering SID Player", async () => {
    liveView.needsStop = true;
    const releasing = releaseDeviceForSidPlayer();
    await vi.advanceTimersByTimeAsync(10);
    await releasing;

    expect(liveView.stop).toHaveBeenCalledWith(null);
    expect(inputRelease.release).not.toHaveBeenCalled();
  });

  it("SPM-MODE-02 a step that fails is logged by name and does not stop the other steps", async () => {
    inputRelease.active = true;
    liveView.needsStop = true;
    inputRelease.release.mockRejectedValueOnce(new Error("pad stuck"));
    const releasing = releaseDeviceForSidPlayer();
    await vi.advanceTimersByTimeAsync(10);
    await releasing;

    expect(liveView.stop).toHaveBeenCalledTimes(1);
    expect(logging.addLog).toHaveBeenCalledWith(
      "warn",
      "Entering SID Player: could not release the device (remote input)",
      expect.objectContaining({ error: "pad stuck" }),
    );
    expect(logging.addLog).toHaveBeenCalledTimes(1);
  });

  it("SPM-MODE-02 music playing on the phone is left alone", async () => {
    const stop = vi.spyOn(LocalSidPlaybackController.prototype, "stop");
    await releaseDeviceForSidPlayer();

    expect(stop).not.toHaveBeenCalled();
    stop.mockRestore();
  });

  it("SPM-MODE-02 untilAborted gives up on a step that cannot be cancelled", async () => {
    const controller = new AbortController();
    const waiting = untilAborted(new Promise<void>(() => undefined), controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow(/abandoned/);
  });
});
