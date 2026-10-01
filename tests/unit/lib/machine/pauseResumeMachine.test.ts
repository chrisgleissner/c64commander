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
const persisted = vi.hoisted(() => ({ pauseMuteSnapshot: null as Record<string, string> | null }));
vi.mock("@/lib/playback/playbackSessionPersistence", () => ({
  hydratePlaybackSnapshot: () => ({ pauseMuteSnapshot: persisted.pauseMuteSnapshot }),
}));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { adoptInterruptedPause, pauseResumeMachine } from "@/lib/machine/pauseResumeMachine";
import { addLog } from "@/lib/logging";

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
    persisted.pauseMuteSnapshot = null;
  });

  // The app was force-stopped while Home had the machine paused and its SIDs at the mute level.
  describe("after a pause the previous session never resumed", () => {
    beforeEach(() => {
      persisted.pauseMuteSnapshot = { "Vol UltiSid 1": " 0 dB" };
    });

    const page = (patch: Record<number, number> = {}) => {
      const bytes = new Uint8Array(0x200).fill(0x42);
      for (const [address, value] of Object.entries(patch)) bytes[Number(address)] = value;
      return bytes;
    };

    it("shows the machine as paused instead of running while zero page and the stack stand still", async () => {
      const readMemory = vi.fn().mockResolvedValue(page());
      await expect(adoptInterruptedPause({ readMemory } as never, "device-1")).resolves.toBe(true);
      expect(setPausedMock).toHaveBeenCalledWith({ pauseMutePending: true });
      expect(restoreMock).not.toHaveBeenCalled();
    });

    it("puts the muted levels back instead when the machine has been resumed since", async () => {
      const readMemory = vi
        .fn()
        .mockResolvedValueOnce(page())
        .mockResolvedValueOnce(page({ 0xa2: 0x49 }));
      await expect(adoptInterruptedPause({ readMemory } as never, "device-1")).resolves.toBe(false);
      expect(setPausedMock).not.toHaveBeenCalled();
      expect(restoreMock).toHaveBeenCalledWith({ readMemory }, "device-1");
    });

    it("leaves a pause the user starts between the two reads to that pause", async () => {
      let releasePause: () => void = () => undefined;
      const pauseCall = run(
        vi.fn(() => new Promise<undefined>((resolve) => (releasePause = () => resolve(undefined)))),
      );
      let pending: Promise<unknown> = Promise.resolve();
      const readMemory = vi
        .fn()
        .mockImplementationOnce(async () => {
          pending = pauseCall.call();
          return page();
        })
        .mockResolvedValueOnce(page({ 0xa2: 0x49 }));

      await expect(adoptInterruptedPause({ readMemory } as never, "device-1")).resolves.toBe(false);
      expect(restoreMock).not.toHaveBeenCalled();
      releasePause();
      await pending;
    });

    it("warns when a pause that has since ended leaves levels it could not restore", async () => {
      restoreMock.mockResolvedValue(false);
      const readMemory = vi
        .fn()
        .mockResolvedValueOnce(page())
        .mockResolvedValueOnce(page({ 0xa2: 0x49 }));
      await expect(adoptInterruptedPause({ readMemory } as never, "device-1")).resolves.toBe(false);
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        "Machine: a pause from a previous session has since ended",
        expect.objectContaining({ levelsRestored: false }),
      );
    });

    it("leaves the machine shown as it was when the memory read fails, to ask again on the next connect", async () => {
      const readMemory = vi.fn().mockRejectedValue(new Error("Host unreachable"));
      await expect(adoptInterruptedPause({ readMemory } as never, "device-1")).resolves.toBe(false);
      expect(setPausedMock).not.toHaveBeenCalled();
    });

    // A game that replaces the KERNAL interrupt leaves the jiffy clock standing while it runs.
    it("treats a running program with its own interrupt as resumed although the jiffy clock stands still", async () => {
      const readMemory = vi
        .fn()
        .mockResolvedValueOnce(page({ 0x1fd: 0x10 }))
        .mockResolvedValueOnce(page({ 0x1fd: 0x37 }));
      await expect(adoptInterruptedPause({ readMemory } as never, "device-1")).resolves.toBe(false);
      expect(setPausedMock).not.toHaveBeenCalled();
    });

    it("restores the levels on resume even though this session never muted them", async () => {
      snapshotState.state = "paused";
      await expect(run().call()).resolves.toBe("running");
      expect(restoreMock).toHaveBeenCalledWith(api, "device-1");
    });

    it("keeps the earlier levels to restore when a second pause finds the SIDs already muted", async () => {
      captureMock.mockResolvedValue(false);
      await run().call();
      expect(setPausedMock).toHaveBeenCalledWith({ pauseMutePending: true });
    });
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
