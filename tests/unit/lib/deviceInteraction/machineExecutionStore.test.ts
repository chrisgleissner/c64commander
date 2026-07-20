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
import { hydratePlaybackSnapshot, persistPlaybackSnapshot } from "@/lib/playback/playbackSessionPersistence";

describe("machineExecutionStore", () => {
  beforeEach(() => {
    resetMachineExecution();
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.clear();
    }
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

    await expect(
      restorePauseMuteFromPersistedSnapshot(
        {
          updateConfigBatch,
        },
        "device-1",
      ),
    ).resolves.toBe(true);

    expect(updateConfigBatch).toHaveBeenCalledWith({
      "Audio Mixer": {
        "Vol Socket 1": "-6 dB",
      },
    });
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteEnablement).toBeNull();
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

    await expect(
      restorePauseMuteFromPersistedSnapshot(
        {
          updateConfigBatch,
        },
        "device-1",
      ),
    ).resolves.toBe(false);

    expect(updateConfigBatch).toHaveBeenCalledTimes(1);
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toEqual({
      "Vol Socket 1": "-6 dB",
    });
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteEnablement).toEqual({
      socket1: true,
    });
  });

  it("HARD18-018: restores a master-shaped pause-mute snapshot (Vol Master) with no migration needed", async () => {
    // pauseMuteSnapshot/pauseMuteEnablement are a plain Record<string, ...>
    // with no fixed per-SID schema - a master-collapsed snapshot restores
    // through the exact same generic buildEnabledSidUnmuteUpdates path an
    // old per-SID snapshot does (see the two tests above), so no dedicated
    // master-shape handling or migration is required here.
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

    await expect(
      restorePauseMuteFromPersistedSnapshot(
        {
          updateConfigBatch,
        },
        "device-1",
      ),
    ).resolves.toBe(true);

    expect(updateConfigBatch).toHaveBeenCalledWith({
      "Audio Mixer": {
        "Vol Master": "0 dB",
      },
    });
    expect(hydratePlaybackSnapshot("device-1")?.pauseMuteSnapshot).toBeNull();
  });
});
