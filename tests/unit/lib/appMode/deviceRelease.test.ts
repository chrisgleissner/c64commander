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
