/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMock = vi.hoisted(() => vi.fn());
const restoreMock = vi.hoisted(() => vi.fn());
const snapshotState = vi.hoisted(() => ({ state: "running" as "running" | "paused", pauseMutePending: false }));
const setPausedMock = vi.hoisted(() => vi.fn());
const setRunningMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/deviceInteraction/machineExecutionStore", () => ({
  getMachineExecutionSnapshot: () => snapshotState,
  restorePauseMuteFromPersistedSnapshot: restoreMock,
  setMachineExecutionPaused: setPausedMock,
  setMachineExecutionRunning: setRunningMock,
}));
vi.mock("@/lib/deviceInteraction/pauseMuteCapture", () => ({
  capturePauseMuteToPersistedSnapshot: captureMock,
}));

import { pauseResumeMachine } from "@/lib/machine/pauseResumeMachine";

const api = {} as never;

const run = (pause = vi.fn(async () => undefined), resume = vi.fn(async () => undefined)) => ({
  pause,
  resume,
  call: () => pauseResumeMachine({ api, deviceId: "device-1", pause, resume }),
});

describe("pauseResumeMachine, the one implementation the tile and the keypad key share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotState.state = "running";
    snapshotState.pauseMutePending = false;
    captureMock.mockResolvedValue(true);
    restoreMock.mockResolvedValue(undefined);
  });

  it("joins a pause already in flight instead of capturing the mixer a second time", async () => {
    let releasePause: () => void = () => undefined;
    const pause = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePause = resolve;
        }),
    );
    const harness = run(pause);

    const first = harness.call();
    const second = harness.call();
    await vi.waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
    releasePause();

    await expect(Promise.all([first, second])).resolves.toEqual(["paused", "paused"]);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("mutes the SID mixer before it pauses a running machine", async () => {
    const harness = run();

    await expect(harness.call()).resolves.toBe("paused");

    expect(captureMock).toHaveBeenCalledWith(api, "device-1");
    expect(captureMock.mock.invocationCallOrder[0]).toBeLessThan(harness.pause.mock.invocationCallOrder[0]);
    expect(setPausedMock).toHaveBeenCalledWith({ pauseMutePending: true });
  });

  it("puts the mute back when the pause itself fails, so a running machine is not left silent", async () => {
    const pause = vi.fn(async () => {
      throw new Error("pause rejected");
    });
    const harness = run(pause);

    await expect(harness.call()).rejects.toThrow("pause rejected");

    expect(restoreMock).toHaveBeenCalledWith(api, "device-1");
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it("leaves the mixer alone when the pause fails and no mute was applied", async () => {
    captureMock.mockResolvedValue(false);
    const pause = vi.fn(async () => {
      throw new Error("pause rejected");
    });

    await expect(run(pause).call()).rejects.toThrow("pause rejected");

    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("restores a mute taken on another page when it resumes", async () => {
    snapshotState.state = "paused";
    snapshotState.pauseMutePending = true;
    const harness = run();

    await expect(harness.call()).resolves.toBe("running");

    expect(harness.resume).toHaveBeenCalledTimes(1);
    expect(restoreMock).toHaveBeenCalledWith(api, "device-1");
    expect(setRunningMock).toHaveBeenCalledTimes(1);
  });

  it("does not touch the mixer on a resume with no mute outstanding", async () => {
    snapshotState.state = "paused";
    snapshotState.pauseMutePending = false;

    await expect(run().call()).resolves.toBe("running");

    expect(restoreMock).not.toHaveBeenCalled();
    expect(setRunningMock).toHaveBeenCalledTimes(1);
  });
});
