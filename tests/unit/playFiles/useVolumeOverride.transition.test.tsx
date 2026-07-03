/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVolumeOverride } from "@/pages/playFiles/hooks/useVolumeOverride";

const mutateAsyncMock = vi.fn();
const getConfigItemsMock = vi.fn();

const connectionStatusRef = {
  current: {
    state: "REAL_CONNECTED",
    isConnected: true,
    isConnecting: false,
  },
};

type MixerItem = {
  name: string;
  value: string;
  options: string[];
};

const audioMixerItemsRef = {
  current: [
    {
      name: "SID 1",
      value: "0",
      options: ["OFF", "-42 dB", "0", "5"],
    },
  ] as MixerItem[],
};

const sidSocketsCategoryRef = { current: {} };
const sidAddressingCategoryRef = { current: {} };

vi.mock("@/hooks/useC64Connection", () => ({
  VISIBLE_C64_QUERY_OPTIONS: {
    intent: "user",
    refetchOnMount: "always",
  },
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
  AUDIO_MIXER_MASTER_VOLUME_ITEM: "Vol Master",
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

const buildEnabledSidRestoreUpdatesMock = vi.fn(
  (_items: MixerItem[], _enablement: unknown, snapshot: Record<string, string | number>) => snapshot,
);
const buildEnabledSidMutedToTargetUpdatesMock = vi.fn((_items: MixerItem[], _enablement: unknown, target: string) => ({
  "SID 1": target,
}));
const buildEnabledSidVolumeUpdatesMock = vi.fn((_items: MixerItem[], _enablement: unknown, target: string) => ({
  "SID 1": target,
}));

vi.mock("@/lib/config/sidVolumeControl", () => ({
  buildEnabledSidMutedToTargetUpdates: (...args: unknown[]) => buildEnabledSidMutedToTargetUpdatesMock(...args),
  buildEnabledSidUnmuteUpdates: vi.fn((volumes: Record<string, string | number>) => volumes),
  buildEnabledSidRestoreUpdates: (...args: unknown[]) => buildEnabledSidRestoreUpdatesMock(...args),
  buildEnabledSidVolumeSnapshot: vi.fn(() => ({ "SID 1": "0" })),
  buildSidEnablement: vi.fn(() => ({ sid1: true })),
  buildSidVolumeSteps: vi.fn(() => [
    { option: "0", label: "0", numeric: 0 },
    { option: "5", label: "5", numeric: 5 },
  ]),
  filterEnabledSidVolumeItems: vi.fn((items: MixerItem[]) => items),
  buildEnabledSidMuteUpdates: vi.fn(() => ({ "SID 1": "-42 dB" })),
  buildEnabledSidVolumeUpdates: (...args: unknown[]) => buildEnabledSidVolumeUpdatesMock(...args),
  isSidVolumeOffValue: vi.fn((value: string | number | undefined) => value === "OFF"),
  resolveSidMutedVolumeOption: vi.fn(() => "-42 dB"),
}));

vi.mock("@/pages/playFiles/playFilesUtils", () => ({
  extractAudioMixerItems: (items: MixerItem[]) => items,
  parseVolumeOption: (value: string | number) => Number(value),
}));

describe("useVolumeOverride transition race", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionStatusRef.current = {
      state: "REAL_CONNECTED",
      isConnected: true,
      isConnecting: false,
    };
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "0",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];
    sidSocketsCategoryRef.current = {};
    sidAddressingCategoryRef.current = {};
    mutateAsyncMock.mockResolvedValue(undefined);
    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") return Promise.resolve(audioMixerItemsRef.current);
      return Promise.resolve({});
    });
    buildEnabledSidRestoreUpdatesMock.mockImplementation(
      (_items: MixerItem[], _enablement: unknown, snapshot: Record<string, string | number>) => snapshot,
    );
    buildEnabledSidMutedToTargetUpdatesMock.mockImplementation(
      (_items: MixerItem[], _enablement: unknown, target: string) => ({ "SID 1": target }),
    );
    buildEnabledSidVolumeUpdatesMock.mockImplementation(
      (_items: MixerItem[], _enablement: unknown, target: string) => ({ "SID 1": target }),
    );
  });

  it("reapplies the new track volume after a restore and playback-start unmute race overlap", async () => {
    let resolveRestore: (() => void) | null = null;
    let resolveUnmute: (() => void) | null = null;
    mutateAsyncMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRestore = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveUnmute = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.index).toBe(0));

    await act(async () => {
      await result.current.handleVolumeCommit(1);
    });
    await waitFor(() => expect(result.current.volumeSessionActiveRef.current).toBe(true));
    expect(result.current.volumeSessionSnapshotRef.current).toEqual({ "SID 1": "0" });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.index).toBe(0);
    expect(result.current.volumeState.muted).toBe(true);

    const restorePromise = result.current.restoreVolumeOverrides("track-transition");
    const ensurePromise = result.current.ensureUnmuted({ force: true, refreshItems: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );
    expect(mutateAsyncMock).toHaveBeenCalledTimes(3);

    resolveRestore?.();

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(4);
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "5" } }),
    );

    resolveUnmute?.();
    await act(async () => {
      await Promise.all([restorePromise, ensurePromise]);
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(result.current.volumeState.index).toBe(1);
    expect(buildEnabledSidRestoreUpdatesMock).toHaveBeenCalledWith(expect.any(Array), expect.anything(), {
      "SID 1": "0",
    });
    expect(buildEnabledSidMutedToTargetUpdatesMock).toHaveBeenCalledWith(expect.any(Array), expect.anything(), "5");
  });

  it("waits for an in-flight playback-start unmute before sending stop restore updates", async () => {
    let resolveUnmute: (() => void) | null = null;
    let resolveRestore: (() => void) | null = null;
    mutateAsyncMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveUnmute = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRestore = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.index).toBe(0));

    await act(async () => {
      await result.current.handleVolumeCommit(1);
    });

    await act(async () => {
      await result.current.handleToggleMute();
    });

    const ensurePromise = result.current.ensureUnmuted({ force: true, refreshItems: true });
    await act(async () => {
      await Promise.resolve();
    });

    const restorePromise = result.current.restoreVolumeOverrides("stop");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "5" } }),
    );
    expect(mutateAsyncMock).toHaveBeenCalledTimes(3);

    resolveUnmute?.();

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(4);
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );

    resolveRestore?.();
    await act(async () => {
      await Promise.all([ensurePromise, restorePromise]);
    });
  });

  it("waits for an in-flight direct audio mixer write before sending stop restore updates", async () => {
    let resolveResumeUnmute: (() => void) | null = null;
    let resolveRestore: (() => void) | null = null;
    mutateAsyncMock
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveResumeUnmute = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRestore = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.index).toBe(0));

    await act(async () => {
      await result.current.handleVolumeCommit(1);
    });

    const resumePromise = result.current.applyAudioMixerUpdates({ "SID 1": "5" }, "Resume unmute");
    await act(async () => {
      await Promise.resolve();
    });

    const restorePromise = result.current.restoreVolumeOverrides("stop");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "5" } }),
    );
    expect(mutateAsyncMock).toHaveBeenCalledTimes(2);

    resolveResumeUnmute?.();

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledTimes(3);
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );

    resolveRestore?.();
    await act(async () => {
      await Promise.all([resumePromise, restorePromise]);
    });
  });

  it("treats a pending mute write as the effective state for the next rapid toggle", async () => {
    let resolveMuteWrite: (() => void) | null = null;
    mutateAsyncMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveMuteWrite = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(false));

    await act(async () => {
      const firstToggle = result.current.handleToggleMute();
      await Promise.resolve();
      const secondToggle = result.current.handleToggleMute();
      resolveMuteWrite?.();
      await Promise.all([firstToggle, secondToggle]);
    });

    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "-42 dB" } }),
    );
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );
    expect(result.current.volumeState.muted).toBe(false);
    expect(result.current.volumeState.index).toBe(0);
  });

  it("flips local mute parity immediately during rapid unmute-then-mute taps", async () => {
    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(false));

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(true);

    getConfigItemsMock.mockImplementationOnce(
      () =>
        new Promise(() => {
          throw new Error("manual unmute should not wait for a forced mixer refresh");
        }),
    );

    await act(async () => {
      const unmuteToggle = result.current.handleToggleMute();
      await Promise.resolve();
      const muteToggle = result.current.handleToggleMute();
      await Promise.all([unmuteToggle, muteToggle]);
    });

    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "-42 dB" } }),
    );
    expect(getConfigItemsMock).not.toHaveBeenCalled();
  });

  it("preserves the later mute pending write when an earlier unmute finishes", async () => {
    let resolveUnmuteWrite: (() => void) | null = null;
    let resolveMuteWrite: (() => void) | null = null;
    mutateAsyncMock
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveUnmuteWrite = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveMuteWrite = resolve;
          }),
      );

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(false));

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(true);

    let unmuteToggle!: Promise<void>;
    let muteToggle!: Promise<void>;
    await act(async () => {
      unmuteToggle = result.current.handleToggleMute();
      await Promise.resolve();
      muteToggle = result.current.handleToggleMute();
      await Promise.resolve();
    });

    expect(result.current.pendingVolumeWriteRef.current).toMatchObject({
      index: 0,
      muted: true,
    });

    resolveUnmuteWrite?.();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pendingVolumeWriteRef.current).toMatchObject({
      index: 0,
      muted: true,
    });

    resolveMuteWrite?.();
    await act(async () => {
      await Promise.all([unmuteToggle, muteToggle]);
    });

    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "-42 dB" } }),
    );
  });

  it("keeps the unmute pending write authoritative until hardware echoes the restored volume", async () => {
    const { result, rerender } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(false));

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(true);

    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];

    await act(async () => {
      await result.current.handleToggleMute();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(result.current.pendingVolumeWriteRef.current).toMatchObject({
      index: 0,
      muted: false,
    });

    act(() => {
      rerender();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(result.current.pendingVolumeWriteRef.current).toMatchObject({
      index: 0,
      muted: false,
    });

    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "0",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];

    act(() => {
      rerender();
    });

    await waitFor(() => expect(result.current.pendingVolumeWriteRef.current).toBeNull());
    expect(result.current.volumeState.muted).toBe(false);
  });

  it("drops stale unmute queue work when a later mute tap overtakes its async preparation", async () => {
    const enablementResolvers: Array<() => void> = [];
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0", "5"],
      },
      {
        name: "SID 2",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];
    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") return Promise.resolve(audioMixerItemsRef.current);
      if (category === "SID Sockets Configuration" || category === "SID Addressing") {
        return new Promise((resolve) => {
          enablementResolvers.push(() => resolve({}));
        });
      }
      return Promise.resolve({});
    });

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(true));

    let unmuteToggle!: Promise<void>;
    let muteToggle!: Promise<void>;
    await act(async () => {
      unmuteToggle = result.current.handleToggleMute();
      await Promise.resolve();
      muteToggle = result.current.handleToggleMute();
      await Promise.resolve();
    });

    expect(result.current.volumeState.muted).toBe(true);

    enablementResolvers.forEach((resolve) => resolve());
    await act(async () => {
      await Promise.all([unmuteToggle, muteToggle]);
    });

    expect(result.current.volumeState.muted).toBe(true);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "-42 dB" } }),
    );
  });

  it("keeps the UI unmuted while unmute preparation is still resolving live SID enablement", async () => {
    const enablementResolvers: Array<() => void> = [];
    audioMixerItemsRef.current = [
      {
        name: "SID 1",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0", "5"],
      },
      {
        name: "SID 2",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0", "5"],
      },
    ];
    getConfigItemsMock.mockImplementation((category: string) => {
      if (category === "Audio Mixer") return Promise.resolve(audioMixerItemsRef.current);
      if (category === "SID Sockets Configuration" || category === "SID Addressing") {
        return new Promise((resolve) => {
          enablementResolvers.push(() => resolve({}));
        });
      }
      return Promise.resolve({});
    });

    const { result, rerender } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(true));

    let unmuteToggle!: Promise<void>;
    await act(async () => {
      unmuteToggle = result.current.handleToggleMute();
      await Promise.resolve();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(result.current.volumeState.index).toBe(0);

    act(() => {
      rerender();
    });

    expect(result.current.volumeState.muted).toBe(false);
    expect(result.current.pendingVolumeWriteRef.current).toBeNull();

    enablementResolvers.forEach((resolve) => resolve());
    await act(async () => {
      await unmuteToggle;
    });

    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "0" } }),
    );
    expect(result.current.volumeState.muted).toBe(false);
  });

  it("keeps rapid mute bursts aligned with the latest tap parity while writes are still in flight", async () => {
    let resolveFirstWrite: (() => void) | null = null;
    mutateAsyncMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useVolumeOverride({ isPlaying: true, isPaused: false, previewIntervalMs: 200 }),
    );

    await waitFor(() => expect(result.current.volumeState.muted).toBe(false));

    const toggles: Array<Promise<void>> = [];
    await act(async () => {
      for (let index = 0; index < 5; index += 1) {
        toggles.push(result.current.handleToggleMute());
        await Promise.resolve();
      }
    });

    expect(result.current.volumeState.muted).toBe(true);
    expect(result.current.pendingVolumeWriteRef.current).toMatchObject({
      index: 0,
      muted: true,
    });

    resolveFirstWrite?.();
    await act(async () => {
      await Promise.all(toggles);
    });

    expect(result.current.volumeState.muted).toBe(true);
  });
});
