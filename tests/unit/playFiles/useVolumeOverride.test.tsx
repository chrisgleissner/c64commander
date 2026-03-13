import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";
import { addErrorLog, addLog } from "@/lib/logging";

const mutateAsyncMock = vi.fn();
const getConfigItemsMock = vi.fn();

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
    options: ["MUTED", "0", "5"],
  },
];

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: {
      state: "REAL_CONNECTED",
      isConnected: true,
      isConnecting: false,
    },
  }),
  useC64UpdateConfigBatch: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
  useC64ConfigItems: (category: string) => ({
    data: category === "Audio Mixer" ? audioMixerItemsRef.current : {},
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
  resolveAudioMixerMuteValue: () => "MUTED",
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

vi.mock("@/lib/config/sidVolumeControl", () => ({
  buildEnabledSidUnmuteUpdates: (...args: unknown[]) => buildEnabledSidUnmuteUpdatesMock(...args),
  buildEnabledSidRestoreUpdates: vi.fn(() => ({})),
  buildEnabledSidVolumeSnapshot: vi.fn(() => ({ "SID 1": "5" })),
  buildSidEnablement: vi.fn(() => ({ sid1: true })),
  buildSidVolumeSteps: vi.fn(() => [
    { option: "0", label: "0", numeric: 0 },
    { option: "5", label: "5", numeric: 5 },
  ]),
  filterEnabledSidVolumeItems: vi.fn((items: MixerItem[]) => items),
  buildEnabledSidMuteUpdates: vi.fn(() => ({ "SID 1": "MUTED" })),
  buildEnabledSidVolumeUpdates: vi.fn((_items: MixerItem[], _enablement: unknown, target: string) => ({
    "SID 1": target,
  })),
}));

vi.mock("@/pages/playFiles/playFilesUtils", () => ({
  extractAudioMixerItems: (items: MixerItem[]) => items,
  parseVolumeOption: (value: string | number) => Number(value),
}));

describe("useVolumeOverride", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioMixerItemsRef.current = defaultMixerItems("0");
    mutateAsyncMock.mockResolvedValue(undefined);
    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") return Promise.resolve(audioMixerItemsRef.current);
      return Promise.resolve({});
    });
    buildEnabledSidUnmuteUpdatesMock.mockImplementation((volumes: Record<string, string | number>) => volumes);
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

  it("sends mute and unmute writes with the new manual logging paths", async () => {
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

    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith("info", "Play volume mute sent", expect.objectContaining({ index: 1 }));

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
    expect(addLog).toHaveBeenCalledWith("info", "Play volume unmute sent", expect.objectContaining({ index: 1 }));
  });

  it("falls back to the previous volume when playback-start unmute has no snapshot updates", async () => {
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

    expect(mutateAsyncMock).toHaveBeenCalledTimes(2);
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "Play volume unmute sent on playback start",
      expect.objectContaining({ index: 1 }),
    );
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
});
