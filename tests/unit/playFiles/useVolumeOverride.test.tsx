import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";
import { addErrorLog, addLog } from "@/lib/logging";

const mutateAsyncMock = vi.fn();
const getConfigItemsMock = vi.fn();

const connectionStatusRef = {
  current: {
    state: "REAL_CONNECTED",
    isConnected: true,
    isConnecting: false,
  },
};

const sidSocketsCategoryRef = {
  current: {},
};

const sidAddressingCategoryRef = {
  current: {},
};

type MixerItem = {
  name: string;
  value: string;
  options: string[];
};

const audioMixerItemsRef = {
  current: [] as MixerItem[],
};

const defaultMixerItems = (value: string): MixerItem[] => [
  {
    name: "SID 1",
    value,
    options: ["OFF", "-42 dB", "0", "5"],
  },
];

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: connectionStatusRef.current,
  }),
  useC64UpdateConfigBatch: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
  useC64ConfigItems: (category: string) => ({
    data:
      category === "Audio Mixer"
        ? audioMixerItemsRef.current
        : category === "SID Sockets Configuration"
          ? sidSocketsCategoryRef.current
          : sidAddressingCategoryRef.current,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    getConfigItems: (...args: unknown[]) => getConfigItemsMock(...args),
  }),
}));

vi.mock("@/lib/config/audioMixerSolo", () => ({
  isSidVolumeName: () => true,
  resolveAudioMixerMuteValue: () => "-42 dB",
}));

vi.mock("@/lib/config/configItems", () => ({
  AUDIO_MIXER_VOLUME_ITEMS: ["SID 1"],
  SID_ADDRESSING_ITEMS: ["SID_ADDR"],
  SID_SOCKETS_ITEMS: ["SID_SOCKET"],
}));

vi.mock("@/lib/deviceInteraction/deviceActivityGate", () => ({
  beginPlaybackWriteBurst: () => () => undefined,
  waitForMachineTransitionsToSettle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/deviceInteraction/latestIntentWriteLane", () => ({
  createLatestIntentWriteLane: ({ run }: { run: (write: unknown) => Promise<void> }) => ({
    schedule: (write: unknown) => run(write),
  }),
}));

const buildEnabledSidUnmuteUpdatesMock = vi.fn((volumes: Record<string, string | number>) => volumes);
const buildEnabledSidRestoreUpdatesMock = vi.fn(() => ({}));
const buildEnabledSidMutedToTargetUpdatesMock = vi.fn((_items: MixerItem[], _enablement: unknown, target: string) => ({
  "SID 1": target,
}));
const buildEnabledSidVolumeUpdatesMock = vi.fn((_items: MixerItem[], _enablement: unknown, target: string) => ({
  "SID 1": target,
}));
const buildSidEnablementMock = vi.fn(() => ({ sid1: true }));
const filterEnabledSidVolumeItemsMock = vi.fn((items: MixerItem[]) => items);
const buildSidVolumeStepsMock = vi.fn(() => [
  { option: "0", label: "0", numeric: 0 },
  { option: "5", label: "5", numeric: 5 },
]);

vi.mock("@/lib/config/sidVolumeControl", () => ({
  buildEnabledSidMutedToTargetUpdates: (...args: unknown[]) => buildEnabledSidMutedToTargetUpdatesMock(...args),
  buildEnabledSidUnmuteUpdates: (...args: unknown[]) => buildEnabledSidUnmuteUpdatesMock(...args),
  buildEnabledSidRestoreUpdates: (...args: unknown[]) => buildEnabledSidRestoreUpdatesMock(...args),
  buildEnabledSidVolumeSnapshot: vi.fn(() => ({ "SID 1": "5" })),
  buildSidEnablement: (...args: unknown[]) => buildSidEnablementMock(...args),
  buildSidVolumeSteps: (...args: unknown[]) => buildSidVolumeStepsMock(...args),
  filterEnabledSidVolumeItems: (...args: unknown[]) => filterEnabledSidVolumeItemsMock(...args),
  buildEnabledSidMuteUpdates: vi.fn(() => ({ "SID 1": "-42 dB" })),
  buildEnabledSidVolumeUpdates: (...args: unknown[]) => buildEnabledSidVolumeUpdatesMock(...args),
  isSidVolumeOffValue: vi.fn((value: string | number | undefined) => value === "OFF"),
  resolveSidMutedVolumeOption: vi.fn(() => "-42 dB"),
}));

vi.mock("@/pages/playFiles/playFilesUtils", () => ({
  extractAudioMixerItems: (items: MixerItem[]) => items,
  parseVolumeOption: (value: string | number) => Number(value),
}));

describe("useVolumeOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioMixerItemsRef.current = defaultMixerItems("0");
    connectionStatusRef.current = {
      state: "REAL_CONNECTED",
      isConnected: true,
      isConnecting: false,
    };
    sidSocketsCategoryRef.current = {};
    sidAddressingCategoryRef.current = {};
    mutateAsyncMock.mockResolvedValue(undefined);
    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") return Promise.resolve(audioMixerItemsRef.current);
      return Promise.resolve({});
    });
    buildEnabledSidUnmuteUpdatesMock.mockImplementation((volumes: Record<string, string | number>) => volumes);
    buildEnabledSidMutedToTargetUpdatesMock.mockReset();
    buildEnabledSidMutedToTargetUpdatesMock.mockImplementation(
      (_items: MixerItem[], _enablement: unknown, target: string) => ({
        "SID 1": target,
      }),
    );
    buildEnabledSidRestoreUpdatesMock.mockReset();
    buildEnabledSidRestoreUpdatesMock.mockReturnValue({});
    buildEnabledSidVolumeUpdatesMock.mockReset();
    buildEnabledSidVolumeUpdatesMock.mockImplementation(
      (_items: MixerItem[], _enablement: unknown, target: string) => ({
        "SID 1": target,
      }),
    );
    buildSidEnablementMock.mockReset();
    buildSidEnablementMock.mockReturnValue({ sid1: true });
    filterEnabledSidVolumeItemsMock.mockReset();
    filterEnabledSidVolumeItemsMock.mockImplementation((items: MixerItem[]) => items);
    buildSidVolumeStepsMock.mockReset();
    buildSidVolumeStepsMock.mockReturnValue([
      { option: "0", label: "0", numeric: 0 },
      { option: "5", label: "5", numeric: 5 },
    ]);
  });

  it("rate-limits rapid previews and skips duplicate pending writes", async () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(0);
      expect(result.current.volumeState.muted).toBe(false);
    });

    act(() => {
      result.current.handleVolumeAsyncChange(1);
    });

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.handleVolumeAsyncChange(1);
    });

    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Play volume preview suppressed by configured rate limit",
      expect.objectContaining({ index: 1, previewIntervalMs: 200 }),
    );

    nowMs += 250;

    act(() => {
      result.current.handleVolumeAsyncChange(1);
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith(
      "debug",
      "Play volume write skipped while identical write is pending",
      expect.objectContaining({ index: 1, muted: false }),
    );
  });

  it("continues sending preview writes during drag before commit when changes exceed the preview interval", async () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "0",
        options: ["0", "5", "10"],
      },
    ];
    buildSidVolumeStepsMock.mockReturnValue([
      { option: "0", label: "0", numeric: 0 },
      { option: "5", label: "5", numeric: 5 },
      { option: "10", label: "10", numeric: 10 },
    ]);

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(0);
    });

    act(() => {
      result.current.handleVolumeLocalChange([1]);
      result.current.handleVolumeAsyncChange(1);
    });

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    });

    nowMs += 250;

    act(() => {
      result.current.handleVolumeLocalChange([2]);
      result.current.handleVolumeAsyncChange(2);
    });

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        category: "Audio Mixer",
        updates: { "SID 1": "5" },
      }),
    );
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        category: "Audio Mixer",
        updates: { "SID 1": "10" },
      }),
    );
  });

  it("short-circuits commits when the device already matches the requested index", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleVolumeCommit(1);
    });

    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("mutes to -42 dB and restores the current slider target on unmute", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");

    const { result, rerender } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        category: "Audio Mixer",
        updates: { "SID 1": "-42 dB" },
      }),
    );
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Play volume mute requested",
      expect.objectContaining({ muteIndex: 0, previousIndex: 1 }),
    );
    expect(addLog).toHaveBeenCalledWith("info", "Play volume mute sent", expect.objectContaining({ index: 0 }));

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        category: "Audio Mixer",
        updates: { "SID 1": "5" },
      }),
    );
    expect(addLog).toHaveBeenCalledWith("info", "Play volume unmute sent", expect.objectContaining({ index: 1 }));
  });

  it("ignores already-off SID outputs when deriving the shared playback volume target", async () => {
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "OFF",
        options: ["OFF", "-42 dB", "0", "5"],
      },
      {
        name: "SID 2",
        value: "5",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });
  });

  it("does not auto-unmute playback-start state while a manual mute intent is still active", async () => {
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "OFF",
        options: ["OFF", "-42 dB", "0", "5"],
      },
      {
        name: "SID 2",
        value: "5",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];
    buildEnabledSidMutedToTargetUpdatesMock.mockImplementation(
      (items: MixerItem[], _enablement: unknown, target: string) =>
        Object.fromEntries(items.filter((item) => item.value === "-42 dB").map((item) => [item.name, target])),
    );

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "OFF",
        options: ["OFF", "-42 dB", "0", "5"],
      },
      {
        name: "SID 2",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];

    await act(async () => {
      await result.current.ensureUnmuted();
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.volumeState.muted).toBe(true);
    expect(addLog).not.toHaveBeenCalledWith("info", "Play volume unmute sent on playback start", expect.anything());
  });

  it("does not issue playback-start fallback unmute writes while manual mute remains authoritative", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");
    buildEnabledSidUnmuteUpdatesMock.mockReturnValue({});

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    await act(async () => {
      await result.current.ensureUnmuted();
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.volumeState.muted).toBe(true);
    expect(addLog).not.toHaveBeenCalledWith("info", "Play volume unmute sent on playback start", expect.anything());
  });

  it("forces playback-start unmute writes even while manual mute intent is still active", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    await act(async () => {
      await result.current.ensureUnmuted({ force: true, refreshItems: true });
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
    expect(result.current.volumeState.muted).toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Play volume unmute sent on playback start",
      expect.objectContaining({ index: 1 }),
    );
  });

  it("refreshes enabled SID items before unmuting so disabled channels stay muted", async () => {
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "5",
        options: ["OFF", "-42 dB", "0", "5"],
      },
      {
        name: "SID 2",
        value: "5",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];
    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") {
        return Promise.resolve(audioMixerItemsRef.current);
      }
      if (category === "SID Sockets Configuration") {
        return Promise.resolve({ sid1: false, sid2: true });
      }
      return Promise.resolve({ sid1: false, sid2: true });
    });
    buildSidEnablementMock.mockImplementation((sockets?: Record<string, boolean>) => sockets ?? { sid1: true, sid2: true });
    filterEnabledSidVolumeItemsMock.mockImplementation((items: MixerItem[], enablement?: Record<string, boolean>) =>
      items.filter((item) => {
        if (item.name === "SID 1") return enablement?.sid1 !== false;
        if (item.name === "SID 2") return enablement?.sid2 !== false;
        return true;
      }),
    );
    buildEnabledSidMutedToTargetUpdatesMock.mockImplementation(
      (items: MixerItem[], _enablement: unknown, target: string) => Object.fromEntries(items.map((item) => [item.name, target])),
    );

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(mutateAsyncMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        updates: { "SID 2": "5" },
      }),
    );
  });

  it("rolls back the immediate mute UI state when the mute write fails", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");
    mutateAsyncMock.mockRejectedValueOnce(new Error("mute failed"));

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.handleToggleMute();
      }),
    ).rejects.toThrow("mute failed");

    expect(result.current.volumeState.muted).toBe(false);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("restores the muted UI state when the unmute write fails", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");
    mutateAsyncMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("unmute failed"));

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    await expect(
      act(async () => {
        await result.current.handleToggleMute();
      }),
    ).rejects.toThrow("unmute failed");

    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).toHaveBeenCalled();
  });

  it("does nothing when ensureUnmuted runs while playback is already unmuted", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.ensureUnmuted();
    });

    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("does not attempt to toggle mute when there are no enabled SID volume items", async () => {
    audioMixerItemsRef.current = [];

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("does not attempt playback-start unmute writes when the device exposes no enabled SID volume items", async () => {
    audioMixerItemsRef.current = [];

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    act(() => {
      result.current.dispatchVolume({ type: "mute", reason: "pause", index: 0 });
    });

    await act(async () => {
      await result.current.ensureUnmuted();
    });

    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("does not send a playback-start unmute write when device sync already restored active playback", async () => {
    audioMixerItemsRef.current = defaultMixerItems("0");

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(0);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleVolumeCommit(1);
    });

    act(() => {
      result.current.dispatchVolume({ type: "mute", reason: "pause", index: 0 });
    });

    await act(async () => {
      await result.current.ensureUnmuted();
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.volumeState.muted).toBe(false);
    expect(addLog).not.toHaveBeenCalledWith("info", "Play volume unmute sent on playback start", expect.anything());
  });

  it("does not issue fallback playback-start writes when device sync already reports active playback", async () => {
    audioMixerItemsRef.current = defaultMixerItems("0");
    buildEnabledSidMutedToTargetUpdatesMock.mockReturnValue({});

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(0);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleVolumeCommit(1);
    });

    act(() => {
      result.current.dispatchVolume({ type: "mute", reason: "pause", index: 0 });
    });

    await act(async () => {
      await result.current.ensureUnmuted();
    });

    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(result.current.volumeState.muted).toBe(false);
    expect(addLog).not.toHaveBeenCalledWith("info", "Play volume unmute sent on playback start", expect.anything());
  });

  it("does not issue preview commits while muted and only updates the cached target", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    mutateAsyncMock.mockClear();

    await act(async () => {
      await result.current.handleVolumeCommit(0);
    });

    expect(result.current.volumeState.index).toBe(0);
    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("unmutes locally without a second write when no unmute updates are needed", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");
    buildEnabledSidMutedToTargetUpdatesMock.mockReturnValue({});
    buildEnabledSidUnmuteUpdatesMock.mockReturnValue({});
    buildEnabledSidVolumeUpdatesMock.mockReturnValue({});

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => {
      expect(result.current.volumeState.index).toBe(1);
      expect(result.current.volumeState.muted).toBe(false);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("reports failed preview writes with phase-specific context", async () => {
    mutateAsyncMock.mockRejectedValueOnce(new Error("preview failed"));

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );

    act(() => {
      result.current.handleVolumeAsyncChange(1);
    });

    await waitFor(() => {
      expect(addErrorLog).toHaveBeenCalledWith(
        "Volume update failed",
        expect.objectContaining({
          error: "preview failed",
          phase: "preview",
          index: 1,
        }),
      );
    });
  });

  it("supports disconnected status and resolveVolumeIndex fallback branches", () => {
    connectionStatusRef.current = {
      state: "OFFLINE",
      isConnected: false,
      isConnecting: false,
    };
    audioMixerItemsRef.current = [];
    buildSidVolumeStepsMock.mockReturnValue([]);

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );

    expect(result.current.resolveVolumeIndex("5")).toBe(0);

    audioMixerItemsRef.current = defaultMixerItems("0");
    buildSidVolumeStepsMock.mockReturnValue([
      { option: "0", label: "0", numeric: 0 },
      { option: "5", label: "5", numeric: 5 },
    ]);
    const connected = renderHook(() =>
      useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }),
    );
    expect(connected.result.current.resolveVolumeIndex("5")).toBe(1);
    expect(connected.result.current.resolveVolumeIndex(5)).toBe(1);
    expect(connected.result.current.resolveVolumeIndex("7")).toBe(0);
  });

  it("returns and filters snapshot-based unmute updates", () => {
    buildEnabledSidUnmuteUpdatesMock.mockReturnValue({ "SID 1": "5", "SID 2": "5" });
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );
    const snapshot = { volumes: { "SID 1": "5", "SID 2": "5" }, enablement: { sid1: true } } as any;

    expect(result.current.snapshotToUpdates(snapshot)).toEqual({ "SID 1": "5", "SID 2": "5" });
    expect(
      result.current.snapshotToUpdates(snapshot, [{ name: "SID 1", value: "5", options: ["0", "5"] }] as any),
    ).toEqual({
      "SID 1": "5",
    });
  });

  it("returns null snapshots when playback is inactive or no SID items are available", async () => {
    const inactive = renderHook(() => useVolumeOverride({ isPlaying: false, isPaused: false, previewIntervalMs: 200 }));
    await expect(inactive.result.current.ensureVolumeSessionSnapshot()).resolves.toBeNull();

    audioMixerItemsRef.current = [];
    const noItems = renderHook(() => useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }));
    await expect(noItems.result.current.ensureVolumeSessionSnapshot()).resolves.toBeNull();
  });

  it("returns cached enabled SID volume items without refetching", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await expect(result.current.resolveEnabledSidVolumeItems()).resolves.toEqual(audioMixerItemsRef.current);
    expect(getConfigItemsMock).not.toHaveBeenCalled();
  });

  it("reuses an existing volume session snapshot without refetching", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );
    result.current.volumeSessionSnapshotRef.current = { "SID 1": "5" };

    await expect(result.current.ensureVolumeSessionSnapshot()).resolves.toBe(
      result.current.volumeSessionSnapshotRef.current,
    );
    expect(getConfigItemsMock).not.toHaveBeenCalled();
  });

  it("clears tracked volume overrides without writes when the device is offline or demo-only", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    result.current.volumeSessionActiveRef.current = true;
    result.current.volumeSessionSnapshotRef.current = { "SID 1": "5" };
    result.current.manualMuteSnapshotRef.current = { volumes: { "SID 1": "0" }, enablement: { sid1: true } } as any;
    result.current.pauseMuteSnapshotRef.current = { volumes: { "SID 1": "0" }, enablement: { sid1: true } } as any;
    connectionStatusRef.current = {
      state: "DEMO_ACTIVE",
      isConnected: false,
      isConnecting: false,
    };

    await result.current.restoreVolumeOverrides("playback-ended");

    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(result.current.volumeSessionActiveRef.current).toBe(false);
    expect(result.current.volumeSessionSnapshotRef.current).toBeNull();
    expect(result.current.manualMuteSnapshotRef.current).toBeNull();
    expect(result.current.pauseMuteSnapshotRef.current).toBeNull();
  });

  it("returns early from restore when no session is active or no snapshot exists", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await result.current.restoreVolumeOverrides("inactive");
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    result.current.volumeSessionActiveRef.current = true;
    result.current.volumeSessionSnapshotRef.current = null;
    await result.current.restoreVolumeOverrides("missing-snapshot");
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("restores saved volume overrides when restore updates are available", async () => {
    buildEnabledSidRestoreUpdatesMock.mockReturnValue({ "SID 1": "5" });
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    result.current.volumeSessionActiveRef.current = true;
    result.current.volumeSessionSnapshotRef.current = { "SID 1": "0" };

    await result.current.restoreVolumeOverrides("playback-ended");

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Audio Mixer",
        updates: { "SID 1": "5" },
      }),
    );
    expect(result.current.volumeSessionActiveRef.current).toBe(false);
    expect(result.current.volumeSessionSnapshotRef.current).toBeNull();
  });

  it("logs forced refresh failures for audio mixer and SID enablement lookups", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    getConfigItemsMock.mockImplementationOnce((category: string) => {
      if (category === "Audio Mixer") return Promise.reject(new Error("mixer failed"));
      return Promise.resolve({});
    });

    await expect(result.current.resolveEnabledSidVolumeItems(true)).resolves.toEqual([]);
    expect(addErrorLog).toHaveBeenCalledWith("Audio mixer lookup failed", { error: "mixer failed" });

    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") return Promise.resolve(audioMixerItemsRef.current);
      if (category === "SID Sockets Configuration") return Promise.reject(new Error("enablement failed"));
      return Promise.resolve({});
    });

    await expect(result.current.resolveEnabledSidVolumeItems(true)).resolves.toEqual(audioMixerItemsRef.current);
    expect(addErrorLog).toHaveBeenCalledWith("SID enablement lookup failed", { error: "enablement failed" });
  });

  it("updates manual mute snapshots on local changes and muted commits without sending writes", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    result.current.manualMuteSnapshotRef.current = { volumes: { "SID 1": "0" }, enablement: { sid1: true } } as any;
    act(() => {
      result.current.dispatchVolume({ type: "mute", reason: "manual" });
    });
    await waitFor(() => {
      expect(result.current.volumeState.muted).toBe(true);
    });

    act(() => {
      result.current.handleVolumeLocalChange([1]);
    });
    expect(result.current.manualMuteSnapshotRef.current?.volumes["SID 1"]).toBe("5");

    await result.current.handleVolumeCommit(0);
    expect(result.current.manualMuteSnapshotRef.current?.volumes["SID 1"]).toBe("0");
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("keeps manual mute snapshots unchanged during local changes while unmuted", () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    result.current.manualMuteSnapshotRef.current = { volumes: { "SID 1": "0" }, enablement: { sid1: true } } as any;

    act(() => {
      result.current.handleVolumeLocalChange([1]);
    });

    expect(result.current.manualMuteSnapshotRef.current?.volumes["SID 1"]).toBe("0");
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("falls back to the previous index when manual unmute has no snapshot updates", async () => {
    audioMixerItemsRef.current = defaultMixerItems("5");
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await result.current.handleToggleMute();
    await waitFor(() => {
      expect(result.current.volumeState.muted).toBe(true);
    });
    buildEnabledSidUnmuteUpdatesMock.mockReturnValue({});
    mutateAsyncMock.mockClear();

    await result.current.handleToggleMute();

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Audio Mixer",
        updates: { "SID 1": "5" },
      }),
    );
    expect(addLog).toHaveBeenCalledWith("info", "Play volume unmute sent", expect.objectContaining({ index: 1 }));
  });

  it("short-circuits preview, commit, mute, and unmute helpers when writes are not applicable", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await result.current.ensureUnmuted();
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    await result.current.handleToggleMute();
    await waitFor(() => {
      expect(result.current.volumeState.muted).toBe(true);
    });
    mutateAsyncMock.mockClear();

    act(() => {
      result.current.handleVolumeAsyncChange(1);
    });
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    result.current.dispatchVolume({ type: "unmute", reason: "manual", index: 0 });
    await result.current.handleVolumeCommit(99);
    expect(mutateAsyncMock).not.toHaveBeenCalled();

    audioMixerItemsRef.current = [];
    const noItems = renderHook(() => useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }));
    await noItems.result.current.handleToggleMute();
    noItems.result.current.dispatchVolume({ type: "mute", reason: "manual" });
    await noItems.result.current.ensureUnmuted();

    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });
});
