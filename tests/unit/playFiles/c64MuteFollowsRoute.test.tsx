/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A Mute pressed while the sound comes from the C64 writes the Ultimate's "Vol Master" = OFF. These tests
 * drive the real volume hook and the real mixer rules against an in-memory Audio Mixer, so every assertion
 * is about what the Ultimate would hold, not about which helper was called.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";
import { useC64MuteFollowsRoute } from "@/pages/playFiles/hooks/useC64MuteFollowsRoute";
import { addErrorLog, addLog } from "@/lib/logging";
import type { PlaybackRoute } from "@/lib/playback/playbackEngineRouting";

const VOL_MASTER_OPTIONS = ["OFF", "-42 dB", "-12 dB", "-6 dB", " 0 dB", "+6 dB"];
const STORAGE_KEY = "c64u.playbackSessionSnapshot";
const DEVICE_ID = "device-1";

const ultimate = vi.hoisted(() => ({
  volMaster: " 0 dB",
  version: 0,
  writes: [] as Array<Record<string, string | number>>,
  connection: { state: "REAL_CONNECTED", isConnected: true, isConnecting: false },
  soundsHere: false,
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

const refetch = vi.fn().mockResolvedValue(undefined);

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ status: ultimate.connection }),
  useC64UpdateConfigBatch: () => ({
    isPending: false,
    mutateAsync: async ({ updates }: { updates: Record<string, string | number> }) => {
      ultimate.writes.push(updates);
      if (updates["Vol Master"] !== undefined) ultimate.volMaster = String(updates["Vol Master"]);
      ultimate.version += 1;
      return { errors: [] };
    },
  }),
  useC64ConfigItems: (category: string, items: string[]) => ({
    data: cachedPayload(category === "Audio Mixer" && items.includes("Vol Master") ? "Vol Master" : category),
    refetch,
    isFetched: true,
  }),
}));

vi.mock("@/hooks/useActivePlayback", () => ({
  useActivePlayback: () => ({ local: ultimate.soundsHere, remote: !ultimate.soundsHere, any: true }),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    getConfigItems: vi.fn(async (category: string) => (category === "Audio Mixer" ? mixerPayload() : {})),
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

const persistEnvelope = (overrides: Record<string, unknown>) =>
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      deviceId: DEVICE_ID,
      volumeSnapshot: {},
      volumeActive: false,
      manualMuteSnapshot: null,
      manualMuteEnablement: null,
      pauseMuteSnapshot: null,
      pauseMuteEnablement: null,
      savedAt: 1,
      ...overrides,
    }),
  );

const storedEnvelope = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

type VolumeProps = { isPlaying: boolean; isPaused: boolean; resolvedDeviceId: string | null };

const renderVolume = (props: Partial<VolumeProps> = {}) =>
  renderHook((hookProps: VolumeProps) => useVolumeOverride(hookProps), {
    initialProps: { isPlaying: true, isPaused: false, resolvedDeviceId: DEVICE_ID, ...props },
  });

const labelOf = (result: { current: ReturnType<typeof useVolumeOverride> }) =>
  result.current.volumeSteps[result.current.volumeState.index]?.label;

const waitForLabel = async (result: { current: ReturnType<typeof useVolumeOverride> }, label: string) =>
  waitFor(() => expect(labelOf(result)).toBe(label));

const changeOnTheDevice = (value: string) => {
  ultimate.volMaster = value;
  ultimate.version += 1;
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ultimate.volMaster = " 0 dB";
  ultimate.version = 0;
  ultimate.writes = [];
  ultimate.connection = { state: "REAL_CONNECTED", isConnected: true, isConnecting: false };
  ultimate.soundsHere = false;
  ultimate.cache.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("Play page Mute on the C64's Vol Master", () => {
  it("shows OFF, the value it wrote, rather than the per-SID -42 dB fallback", async () => {
    const { result } = renderVolume({ resolvedDeviceId: null });
    await waitForLabel(result, "0 dB");

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(ultimate.volMaster).toBe("OFF");
    expect(result.current.volumeState.muted).toBe(true);
    expect(labelOf(result)).toBe("OFF");
  });

  it("restores the C64 on Stop after a remount hydrated an empty saved session", async () => {
    persistEnvelope({ volumeSnapshot: {}, volumeActive: false });
    const { result, rerender } = renderVolume();
    await waitForLabel(result, "0 dB");

    await act(async () => {
      await result.current.handleToggleMute();
    });
    expect(ultimate.volMaster).toBe("OFF");

    rerender({ isPlaying: false, isPaused: false, resolvedDeviceId: DEVICE_ID });
    await act(async () => {
      await result.current.restoreVolumeOverrides("stop");
    });

    expect(ultimate.volMaster).toBe(" 0 dB");
  });

  it("follows the C64 again after Stop restored a manual mute", async () => {
    const { result, rerender } = renderVolume({ resolvedDeviceId: null });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });
    rerender({ isPlaying: false, isPaused: false, resolvedDeviceId: null });
    await act(async () => {
      await result.current.restoreVolumeOverrides("stop");
    });

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    changeOnTheDevice("-6 dB");
    rerender({ isPlaying: false, isPaused: false, resolvedDeviceId: null });

    await waitForLabel(result, "-6 dB");
    vi.restoreAllMocks();
  });
});

describe("Stop with the C64 out of reach", () => {
  it("ends the session and the manual mute without writing to the C64", async () => {
    const { result, rerender } = renderVolume({ resolvedDeviceId: null });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });
    const writesBeforeStop = ultimate.writes.length;

    ultimate.connection = { state: "OFFLINE_NO_DEMO", isConnected: false, isConnecting: false };
    rerender({ isPlaying: false, isPaused: false, resolvedDeviceId: null });
    await act(async () => {
      await result.current.restoreVolumeOverrides("stop");
    });

    expect(ultimate.writes).toHaveLength(writesBeforeStop);
    expect(result.current.volumeSessionActiveRef.current).toBe(false);
    expect(result.current.manualMuteSnapshotRef.current).toBeNull();
  });
});

describe("a saved mute snapshot the C64 no longer matches", () => {
  it("is dropped, logged and saved when the C64 reads back unmuted", async () => {
    persistEnvelope({ manualMuteSnapshot: { "Vol Master": "-12 dB" }, manualMuteEnablement: {} });
    const { result } = renderVolume({ isPlaying: false });
    await waitForLabel(result, "0 dB");

    await waitFor(() => expect(storedEnvelope().manualMuteSnapshot).toBeNull());
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Play volume mute snapshot dropped: the C64 reports it unmuted",
      expect.any(Object),
    );
    expect(result.current.manualMuteSnapshotRef.current).toBeNull();
  });

  it("lets the row follow a C64 unmuted on its own menu after a restart left it muted", async () => {
    changeOnTheDevice("OFF");
    persistEnvelope({ manualMuteSnapshot: { "Vol Master": "-12 dB" }, manualMuteEnablement: {} });
    const { result, rerender } = renderVolume({ isPlaying: false });
    await waitFor(() => expect(result.current.volumeState.muted).toBe(true));

    changeOnTheDevice("-6 dB");
    rerender({ isPlaying: false, isPaused: false, resolvedDeviceId: DEVICE_ID });

    await waitFor(() => expect(result.current.volumeState.muted).toBe(false));
    expect(labelOf(result)).toBe("-6 dB");
    expect(result.current.manualMuteSnapshotRef.current).toBeNull();
  });
});

describe("releasing a C64 mute the app wrote", () => {
  it("restores the level from before the Mute and reports that it did", async () => {
    const { result } = renderVolume({ resolvedDeviceId: null });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });

    let released = false;
    await act(async () => {
      released = await result.current.releaseManualMute("test");
    });

    expect(released).toBe(true);
    expect(ultimate.volMaster).toBe(" 0 dB");
    expect(result.current.volumeState.muted).toBe(false);
  });

  it("writes nothing when no mute is held", async () => {
    const { result } = renderVolume({ resolvedDeviceId: null });
    await waitForLabel(result, "0 dB");

    let released = true;
    await act(async () => {
      released = await result.current.releaseManualMute("test");
    });

    expect(released).toBe(false);
    expect(ultimate.writes).toEqual([]);
  });
});

type RouteProps = {
  route: PlaybackRoute;
  isPlaying: boolean;
  sidPlaying: boolean;
  isPaused?: boolean;
  resolvedDeviceId?: string | null;
};

const renderPlayPage = (initial: RouteProps) => {
  const muteHere = vi.fn();
  const hook = renderHook(
    ({ route, isPlaying, sidPlaying, isPaused = false, resolvedDeviceId = null }: RouteProps) => {
      const volume = useVolumeOverride({ isPlaying, isPaused, resolvedDeviceId });
      useC64MuteFollowsRoute({ route, c64Mute: volume, sidPlaying, muteHere });
      return volume;
    },
    { initialProps: initial },
  );
  return { ...hook, muteHere };
};

const pauseOnTheC64 = async (result: { current: ReturnType<typeof useVolumeOverride> }) => {
  await act(async () => {
    result.current.pauseMuteSnapshotRef.current = { volumes: { "Vol Master": ultimate.volMaster }, enablement: {} };
    result.current.dispatchVolume({ type: "mute", reason: "pause" });
    await result.current.applyAudioMixerUpdates({ "Vol Master": "OFF" }, "Pause mute");
  });
  await waitFor(() => expect(result.current.volumeState).toMatchObject({ muted: true, reason: "sync" }));
};

describe("a C64 mute when the sound moves to this phone", () => {
  it("unmutes the Ultimate and mutes this phone instead", async () => {
    const { result, rerender, muteHere } = renderPlayPage({ route: "c64", isPlaying: false, sidPlaying: false });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });
    expect(ultimate.volMaster).toBe("OFF");

    rerender({ route: "local", isPlaying: false, sidPlaying: false });

    await waitFor(() => expect(ultimate.volMaster).toBe(" 0 dB"));
    expect(muteHere).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith("info", "Play volume mute released on the C64", {
      reason: "listening-route-left-c64",
    });
  });

  it("waits for a SID still being moved off the C64 before writing its mixer", async () => {
    const { result, rerender, muteHere } = renderPlayPage({ route: "c64", isPlaying: true, sidPlaying: true });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });

    rerender({ route: "local", isPlaying: true, sidPlaying: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(muteHere).toHaveBeenCalledTimes(1);
    expect(ultimate.volMaster).toBe("OFF");

    ultimate.soundsHere = true;
    rerender({ route: "local", isPlaying: true, sidPlaying: true });

    await waitFor(() => expect(ultimate.volMaster).toBe(" 0 dB"));
  });

  it("leaves the Ultimate alone while it is out of reach and releases it on return", async () => {
    const { result, rerender, muteHere } = renderPlayPage({ route: "c64", isPlaying: false, sidPlaying: false });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });

    ultimate.connection = { state: "OFFLINE_NO_DEMO", isConnected: false, isConnecting: false };
    rerender({ route: "local", isPlaying: false, sidPlaying: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(ultimate.volMaster).toBe("OFF");
    expect(muteHere).toHaveBeenCalledTimes(1);

    ultimate.connection = { state: "REAL_CONNECTED", isConnected: true, isConnecting: false };
    rerender({ route: "local", isPlaying: false, sidPlaying: false });

    await waitFor(() => expect(ultimate.volMaster).toBe(" 0 dB"));
  });

  it("keeps the C64 mute while the C64 is still the route", async () => {
    const { result, rerender, muteHere } = renderPlayPage({ route: "c64", isPlaying: true, sidPlaying: true });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });

    rerender({ route: "c64", isPlaying: false, sidPlaying: false });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ultimate.volMaster).toBe("OFF");
    expect(muteHere).not.toHaveBeenCalled();
  });
});

describe("a C64 muted by a pause rather than by Mute", () => {
  it("leaves this phone audible when the paused tune moves here", async () => {
    const { result, rerender, muteHere } = renderPlayPage({ route: "c64", isPlaying: true, sidPlaying: true });
    await waitForLabel(result, "0 dB");
    await pauseOnTheC64(result);

    rerender({ route: "local", isPlaying: true, sidPlaying: true, isPaused: true });
    ultimate.soundsHere = true;
    rerender({ route: "local", isPlaying: true, sidPlaying: true, isPaused: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(muteHere).not.toHaveBeenCalled();
    expect(addLog).not.toHaveBeenCalledWith("info", "Play volume mute released on the C64", expect.anything());
  });

  it("still moves a Mute pressed before the pause", async () => {
    const { result, rerender, muteHere } = renderPlayPage({ route: "c64", isPlaying: true, sidPlaying: true });
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });
    await pauseOnTheC64(result);

    rerender({ route: "local", isPlaying: true, sidPlaying: true, isPaused: true });

    await waitFor(() => expect(muteHere).toHaveBeenCalledTimes(1));
  });
});

describe("a Mute across an app restart", () => {
  it("is saved when it is pressed, so a restart that ends the session restores the C64", async () => {
    const first = renderVolume();
    await waitForLabel(first.result, "0 dB");
    await act(async () => {
      await first.result.current.handleToggleMute();
    });
    expect(storedEnvelope()).toMatchObject({
      volumeActive: true,
      volumeSnapshot: { "Vol Master": " 0 dB" },
      manualMuteSnapshot: { "Vol Master": " 0 dB" },
    });
    first.unmount();

    const restarted = renderVolume({ isPlaying: false });
    await waitFor(() => expect(restarted.result.current.volumeState.muted).toBe(true));
    await act(async () => {
      await restarted.result.current.restoreVolumeOverrides("playback-ended");
    });

    expect(ultimate.volMaster).toBe(" 0 dB");
  });

  it("is released on this phone's route after a restart", async () => {
    const first = renderVolume();
    await waitForLabel(first.result, "0 dB");
    await act(async () => {
      await first.result.current.handleToggleMute();
    });
    first.unmount();

    renderPlayPage({ route: "local", isPlaying: false, sidPlaying: false, resolvedDeviceId: DEVICE_ID });

    await waitFor(() => expect(ultimate.volMaster).toBe(" 0 dB"));
  });

  it("is forgotten in the saved session once Unmute is pressed", async () => {
    const { result } = renderVolume();
    await waitForLabel(result, "0 dB");
    await act(async () => {
      await result.current.handleToggleMute();
    });
    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(storedEnvelope().manualMuteSnapshot).toBeNull();
  });
});

describe("useC64MuteFollowsRoute on its own", () => {
  const renderRoute = (props: { route: PlaybackRoute; c64Muted: boolean }, release: () => Promise<boolean>) => {
    const muteHere = vi.fn();
    const releaseManualMute = vi.fn(release);
    const hook = renderHook(
      ({ route, c64Muted }: { route: PlaybackRoute; c64Muted: boolean }) =>
        useC64MuteFollowsRoute({
          route,
          c64Mute: {
            volumeState: { index: 0, muted: c64Muted, reason: "manual" },
            isManualMuteHeld: () => c64Muted,
            releaseManualMute,
          },
          sidPlaying: false,
          muteHere,
        }),
      { initialProps: props },
    );
    return { ...hook, muteHere, releaseC64Mute: releaseManualMute };
  };

  it("releases a C64 mute found on the phone route at start without muting the phone", async () => {
    const { muteHere, releaseC64Mute } = renderRoute({ route: "local", c64Muted: true }, async () => true);

    await waitFor(() => expect(releaseC64Mute).toHaveBeenCalledTimes(1));
    expect(muteHere).not.toHaveBeenCalled();
  });

  it("logs a release that fails, with its stack", async () => {
    const failure = new Error("mixer write timed out");
    renderRoute({ route: "local", c64Muted: true }, async () => {
      throw failure;
    });

    await waitFor(() =>
      expect(addErrorLog).toHaveBeenCalledWith("C64 mute could not be released after the sound moved to this phone", {
        error: "mixer write timed out",
        stack: failure.stack,
      }),
    );
  });

  it("logs a non-Error rejection as text", async () => {
    renderRoute({ route: "local", c64Muted: true }, () => Promise.reject("refused"));

    await waitFor(() =>
      expect(addErrorLog).toHaveBeenCalledWith("C64 mute could not be released after the sound moved to this phone", {
        error: "refused",
        stack: undefined,
      }),
    );
  });

  it("does not start a second release while one is in flight", async () => {
    let finish: (released: boolean) => void = () => undefined;
    const { rerender, releaseC64Mute } = renderRoute(
      { route: "local", c64Muted: true },
      () => new Promise<boolean>((resolve) => (finish = resolve)),
    );
    await waitFor(() => expect(releaseC64Mute).toHaveBeenCalledTimes(1));

    rerender({ route: "c64", c64Muted: true });
    rerender({ route: "local", c64Muted: true });
    expect(releaseC64Mute).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(true);
    });
  });
});
