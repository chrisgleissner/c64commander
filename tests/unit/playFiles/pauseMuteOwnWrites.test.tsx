/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Play pauses and resumes on a mixer another client shares. These tests drive the real volume hook and the real
 * pause mute against an in-memory Audio Mixer and assert what the Ultimate holds after Stop restores.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";
import { usePauseMute } from "@/pages/playFiles/hooks/usePauseMute";
import { buildEnabledSidMuteUpdates } from "@/lib/config/sidVolumeControl";

const VOL_MASTER_OPTIONS = ["OFF", "-42 dB", "-12 dB", "-6 dB", " 0 dB", "+6 dB"];
const DEVICE_ID = "device-1";

const ultimate = vi.hoisted(() => ({
  volMaster: " 0 dB",
  version: 0,
  cache: new Map<string, unknown>(),
}));

const mixerPayload = () => ({
  "Audio Mixer": { items: { "Vol Master": { selected: ultimate.volMaster, options: VOL_MASTER_OPTIONS } } },
});

const cachedPayload = (query: string) => {
  const key = `${query}@${ultimate.version}`;
  if (!ultimate.cache.has(key)) ultimate.cache.set(key, query === "Vol Master" ? mixerPayload() : {});
  return ultimate.cache.get(key);
};

const setOnTheUltimate = (value: string) => {
  ultimate.volMaster = value;
  ultimate.version += 1;
};

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: { state: "REAL_CONNECTED", isConnected: true, isConnecting: false } }),
  useC64UpdateConfigBatch: () => ({
    isPending: false,
    mutateAsync: async ({ updates }: { updates: Record<string, string | number> }) => {
      if (updates["Vol Master"] !== undefined) setOnTheUltimate(String(updates["Vol Master"]));
      return { errors: [] };
    },
  }),
  useC64ConfigItems: (category: string, items: string[]) => ({
    data: cachedPayload(category === "Audio Mixer" && items.includes("Vol Master") ? "Vol Master" : category),
    refetch: vi.fn().mockResolvedValue(undefined),
    isFetched: true,
  }),
}));

vi.mock("@/hooks/useActivePlayback", () => ({
  useActivePlayback: () => ({ local: false, remote: true, any: true }),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    getConfigItems: vi.fn(async (category: string) => (category === "Audio Mixer" ? mixerPayload() : {})),
    getCategory: vi.fn(async (category: string) => (category === "Audio Mixer" ? mixerPayload() : {})),
  }),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: (error: Error, details: Record<string, unknown>) => ({ error: error.message, ...details }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@/lib/deviceInteraction/deviceActivityGate", () => ({
  beginPlaybackWriteBurst: () => () => undefined,
  waitForMachineTransitionsToSettle: vi.fn().mockResolvedValue(undefined),
}));

const renderPlay = () =>
  renderHook(() => {
    const volume = useVolumeOverride({ isPlaying: true, isPaused: false, resolvedDeviceId: DEVICE_ID });
    const pauseMute = usePauseMute({
      enabledSidVolumeItems: volume.enabledSidVolumeItems,
      sidEnablement: volume.sidEnablement,
      captureSidMuteSnapshot: volume.captureSidMuteSnapshot,
      buildEnabledSidMuteUpdates,
      snapshotToUpdates: volume.snapshotToUpdates,
      applyAudioMixerUpdates: volume.applyAudioMixerUpdates,
      ensureUnmuted: volume.ensureUnmuted,
      isManualMuteHeld: volume.isManualMuteHeld,
      dispatchVolume: volume.dispatchVolume,
      pauseMuteSnapshotRef: volume.pauseMuteSnapshotRef,
      pausingFromPauseRef: volume.pausingFromPauseRef,
      resumingFromPauseRef: volume.resumingFromPauseRef,
    });
    return { volume, pauseMute };
  });

const overrideTo = async (result: { current: ReturnType<typeof renderPlay>["result"]["current"] }, label: string) => {
  await waitFor(() => expect(result.current.volume.volumeSteps.length).toBeGreaterThan(0));
  const index = result.current.volume.volumeSteps.findIndex((step) => step.label === label);
  await act(async () => {
    await result.current.volume.handleVolumeCommit(index);
  });
  await waitFor(() => expect(ultimate.volMaster.trim()).toBe(label));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  ultimate.volMaster = " 0 dB";
  ultimate.version = 0;
  ultimate.cache.clear();
});

describe("Stop's restore after Play pauses and resumes", () => {
  it("restores the user's level when the level put back on resume was this phone's own override", async () => {
    const { result } = renderPlay();
    await overrideTo(result, "-6 dB");

    await act(async () => {
      await result.current.pauseMute.muteBeforeMachinePause();
    });
    expect(ultimate.volMaster).toBe("OFF");
    await act(async () => {
      await result.current.pauseMute.unmuteAfterMachineResume();
    });
    expect(ultimate.volMaster.trim()).toBe("-6 dB");

    await act(async () => {
      await result.current.volume.restoreVolumeOverrides("stop");
    });

    expect(ultimate.volMaster.trim()).toBe("0 dB");
  });

  it("leaves a level another client set before the pause alone when Stop restores", async () => {
    const { result } = renderPlay();
    await overrideTo(result, "-6 dB");
    setOnTheUltimate("-12 dB");

    await act(async () => {
      await result.current.pauseMute.muteBeforeMachinePause();
    });
    await act(async () => {
      await result.current.pauseMute.unmuteAfterMachineResume();
    });
    expect(ultimate.volMaster.trim()).toBe("-12 dB");

    await act(async () => {
      await result.current.volume.restoreVolumeOverrides("stop");
    });

    expect(ultimate.volMaster.trim()).toBe("-12 dB");
  });
});
