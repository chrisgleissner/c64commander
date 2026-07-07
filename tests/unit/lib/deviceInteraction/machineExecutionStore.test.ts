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
  setMachineExecutionPaused,
  setMachineExecutionRunning,
  subscribeMachineExecution,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { hydratePlaybackSnapshot, persistPlaybackSnapshot } from "@/pages/playFiles/playbackSessionPersistence";

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
    });

    setMachineExecutionRunning();
    expect(getMachineExecutionSnapshot()).toEqual({
      state: "running",
      pauseMutePending: false,
    });

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
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
