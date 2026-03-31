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
    expect(mutateAsyncMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ category: "Audio Mixer", updates: { "SID 1": "5" } }),
    );

    resolveRestore?.();
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
});
