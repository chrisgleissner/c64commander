/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMachineExecutionSnapshot,
  resetMachineExecution,
  restorePauseMuteFromPersistedSnapshot,
  resumeMachineExecutionIfPausedBy,
  setMachineExecutionPaused,
  setMachineExecutionRunning,
  subscribeMachineExecution,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { keepRestoresOfOwnWrites } from "@/lib/config/sidVolumeControl";
import { hydratePlaybackSnapshot, persistPlaybackSnapshot } from "@/lib/playback/playbackSessionPersistence";
import {
  noteVolumeSessionWrites,
  readVolumeSessionWrites,
  startVolumeSessionWrites,
} from "@/lib/playback/volumeSessionWrites";

describe("machineExecutionStore", () => {
  beforeEach(() => {
    resetMachineExecution();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("tracks paused and running state transitions for Home and Play", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMachineExecution(listener);

    setMachineExecutionPaused({ pauseMutePending: true });
    expect(getMachineExecutionSnapshot()).toEqual({
      state: "paused",
      pauseMutePending: true,
      // HARD21-004: an unsourced pause defaults to "user" (a menu close must not resume it).
      pausedBy: "user",
    });

    setMachineExecutionRunning();
    expect(getMachineExecutionSnapshot()).toEqual({
      state: "running",
      pauseMutePending: false,
      pausedBy: null,
    });

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  // HARD21-004: closing the Home Ultimate menu resumes ONLY a pause the menu
  // itself induced. A user pause (Play or Home) carries a different source and
  // must survive an open+close of the menu.
  describe("HARD21-004: source-gated resume (resumeMachineExecutionIfPausedBy)", () => {
    it("resumes a menu-induced pause on menu close", () => {
      setMachineExecutionPaused({ pausedBy: "menu" });
      expect(getMachineExecutionSnapshot().state).toBe("paused");

      resumeMachineExecutionIfPausedBy("menu");
      expect(getMachineExecutionSnapshot().state).toBe("running");
      expect(getMachineExecutionSnapshot().pausedBy).toBeNull();
    });

    it("does NOT resume a user pause when the menu closes (survives open+close)", () => {
      setMachineExecutionPaused({ pausedBy: "user" });
      // Menu open is a no-op because the machine is already paused (HomePage
      // only pauses if state === "running"), so the source stays "user".
      resumeMachineExecutionIfPausedBy("menu");
      expect(getMachineExecutionSnapshot().state).toBe("paused");
      expect(getMachineExecutionSnapshot().pausedBy).toBe("user");
    });

    it("does NOT resume a Play pause when the menu closes", () => {
      setMachineExecutionPaused({ pausedBy: "play" });
      resumeMachineExecutionIfPausedBy("menu");
      expect(getMachineExecutionSnapshot().state).toBe("paused");
      expect(getMachineExecutionSnapshot().pausedBy).toBe("play");
    });

    it("is a no-op when the machine is already running", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeMachineExecution(listener);
      resumeMachineExecutionIfPausedBy("menu");
      expect(getMachineExecutionSnapshot().state).toBe("running");
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

  const mixerReports = (items: Record<string, string>) =>
    vi.fn().mockResolvedValue({
      "Audio Mixer": {
        items: Object.fromEntries(Object.entries(items).map(([name, value]) => [name, { selected: value }])),
      },
    });

  it("restores the persisted pause-mute snapshot through Audio Mixer updates and clears it on success", async () => {
    persistPlaybackSnapshot({
      deviceId: "device-1",
      volumeSnapshot: {},
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: {
        "Vol Socket 1": "-6 dB",
        "Vol Socket 2": "-12 dB",
      },
      pauseMuteEnablement: {
        socket1: true,
        socket2: false,
      },
    });
    const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });
    const getCategory = mixerReports({ "Vol Socket 1": "-42 dB", "Vol Socket 2": "-42 dB" });

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      true,
    );

    expect(getCategory).toHaveBeenCalledWith("Audio Mixer", { __c64uIntent: "user" });
    // HARD27-011: the unmute undoes the pause mute, so it is marked as the
    // restore of a transient write and must not be persisted to flash on its own.
    expect(updateConfigBatch).toHaveBeenCalledWith(
      {
        "Audio Mixer": {
          "Vol Socket 1": "-6 dB",
        },
      },
      { __c64uTransientConfigWrite: true, __c64uTransientConfigRestore: true },
    );
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteEnablement).toBeNull();
  });

  describe("the record of this phone's mixer writes during a Play volume session", () => {
    const persistSocketPauseMute = () =>
      persistPlaybackSnapshot({
        deviceId: "device-1",
        volumeSnapshot: {},
        volumeActive: true,
        manualMuteSnapshot: null,
        manualMuteEnablement: null,
        pauseMuteSnapshot: { "Vol Socket 1": "-6 dB" },
        pauseMuteEnablement: { socket1: true },
      });

    it("notes the levels a Home resume writes, so Stop still restores the user's level", async () => {
      persistSocketPauseMute();
      startVolumeSessionWrites("device-1");
      noteVolumeSessionWrites({ "Vol Socket 1": "-6 dB" });
      noteVolumeSessionWrites({ "Vol Socket 1": "-42 dB" });
      const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });

      await restorePauseMuteFromPersistedSnapshot(
        { getCategory: mixerReports({ "Vol Socket 1": "-42 dB" }), updateConfigBatch },
        "device-1",
      );

      const liveAfterResume = [{ name: "Vol Socket 1", value: "-6 dB", options: [] }];
      expect(
        keepRestoresOfOwnWrites({ "Vol Socket 1": "0 dB" }, liveAfterResume, readVolumeSessionWrites("device-1")),
      ).toEqual({ "Vol Socket 1": "0 dB" });
    });

    it("does not create a record when no volume session is active", async () => {
      persistSocketPauseMute();

      await restorePauseMuteFromPersistedSnapshot(
        {
          getCategory: mixerReports({ "Vol Socket 1": "-42 dB" }),
          updateConfigBatch: vi.fn().mockResolvedValue({ errors: [] }),
        },
        "device-1",
      );

      expect(readVolumeSessionWrites("device-1")).toBeNull();
    });

    it("does not add the levels of one device to the session record of another", async () => {
      persistSocketPauseMute();
      startVolumeSessionWrites("device-2");

      await restorePauseMuteFromPersistedSnapshot(
        {
          getCategory: mixerReports({ "Vol Socket 1": "-42 dB" }),
          updateConfigBatch: vi.fn().mockResolvedValue({ errors: [] }),
        },
        "device-1",
      );

      expect(readVolumeSessionWrites("device-2")).toEqual({});
    });
  });

  it("keeps the persisted pause-mute snapshot when the restore write fails", async () => {
    persistPlaybackSnapshot({
      deviceId: "device-1",
      volumeSnapshot: {},
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: {
        "Vol Socket 1": "-6 dB",
      },
      pauseMuteEnablement: {
        socket1: true,
      },
    });
    const updateConfigBatch = vi.fn().mockRejectedValue(new Error("write failed"));
    const getCategory = mixerReports({ "Vol Socket 1": "-42 dB" });

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      false,
    );

    expect(updateConfigBatch).toHaveBeenCalledTimes(1);
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toEqual({
      "Vol Socket 1": "-6 dB",
    });
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteEnablement).toEqual({
      socket1: true,
    });
  });

  it("HARD18-018: restores a master-shaped pause-mute snapshot when a category read reports Vol Master OFF without options", async () => {
    persistPlaybackSnapshot({
      deviceId: "device-1",
      volumeSnapshot: {},
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: {
        "Vol Master": "0 dB",
      },
      pauseMuteEnablement: {},
    });
    const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });
    const getCategory = mixerReports({ "Vol Master": "OFF" });

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      true,
    );

    expect(updateConfigBatch).toHaveBeenCalledWith(
      {
        "Audio Mixer": {
          "Vol Master": "0 dB",
        },
      },
      { __c64uTransientConfigWrite: true, __c64uTransientConfigRestore: true },
    );
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
  });
  const persistTwoUltiSidPauseMute = () =>
    persistPlaybackSnapshot({
      deviceId: "device-1",
      volumeSnapshot: {},
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: { "Vol UltiSid 1": " 0 dB", "Vol UltiSid 2": " 0 dB" },
      pauseMuteEnablement: { ultiSid1: true, ultiSid2: true },
    });

  it("restores only the outputs still at the pause mute and keeps a level another client set while paused", async () => {
    persistTwoUltiSidPauseMute();
    const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });
    const getCategory = mixerReports({ "Vol UltiSid 1": "-6 dB", "Vol UltiSid 2": "-42 dB" });

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      true,
    );

    expect(updateConfigBatch).toHaveBeenCalledWith(
      { "Audio Mixer": { "Vol UltiSid 2": " 0 dB" } },
      { __c64uTransientConfigWrite: true, __c64uTransientConfigRestore: true },
    );
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
  });

  it("writes nothing and clears the pause-mute snapshot when every output was changed after the pause", async () => {
    persistTwoUltiSidPauseMute();
    const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });
    const getCategory = mixerReports({ "Vol UltiSid 1": "-6 dB", "Vol UltiSid 2": "+2 dB" });

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      false,
    );

    expect(updateConfigBatch).not.toHaveBeenCalled();
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
  });

  it("restores every pre-pause level when the mixer cannot be read on resume", async () => {
    persistTwoUltiSidPauseMute();
    const updateConfigBatch = vi.fn().mockResolvedValue({ errors: [] });
    const getCategory = vi.fn().mockRejectedValue(new Error("read timed out"));

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      true,
    );

    expect(updateConfigBatch).toHaveBeenCalledWith(
      { "Audio Mixer": { "Vol UltiSid 1": " 0 dB", "Vol UltiSid 2": " 0 dB" } },
      { __c64uTransientConfigWrite: true, __c64uTransientConfigRestore: true },
    );
  });

  it("skips the mixer read when the snapshot holds no enabled output", async () => {
    persistPlaybackSnapshot({
      deviceId: "device-1",
      volumeSnapshot: {},
      volumeActive: true,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: { "Vol Socket 2": "-12 dB" },
      pauseMuteEnablement: { socket2: false },
    });
    const updateConfigBatch = vi.fn();
    const getCategory = vi.fn();

    await expect(restorePauseMuteFromPersistedSnapshot({ getCategory, updateConfigBatch }, "device-1")).resolves.toBe(
      false,
    );

    expect(getCategory).not.toHaveBeenCalled();
    expect(updateConfigBatch).not.toHaveBeenCalled();
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
  });
});
