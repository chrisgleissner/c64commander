/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { getC64API } from "@/lib/c64api";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { applyConfigFileReference, ensureConfigFileReferenceAccessible } from "@/lib/config/applyConfigFileReference";
import { ConfigApplyCancelledError, runCancellableConfigApply } from "@/lib/config/configApplyCancellation";
import { recordPlayLaunchMount } from "@/lib/playback/playLaunchMounts";
import { markRemotePlaybackStopped } from "@/lib/playback/activePlaybackSession";
import { reportUserError } from "@/lib/uiErrors";

vi.mock("@/lib/archive/client", () => ({ createArchiveClient: vi.fn() }));
vi.mock("@/lib/archive/execution", () => ({ buildArchivePlayPlan: vi.fn() }));
vi.mock("@/lib/c64api", () => ({ getC64API: vi.fn(() => ({})) }));
vi.mock("@/lib/playback/playbackRouter", () => ({
  PlaybackLaunchOvertakenError: class extends Error {},
  buildPlayPlan: vi.fn((request) => request),
  executePlayPlan: vi.fn(async (_api, _plan, options) => {
    await options?.beforeLaunch?.();
  }),
  getRememberedUltimateSidBlob: vi.fn(() => null),
  tryFetchUltimateSidBlob: vi.fn(async () => null),
}));
vi.mock("@/lib/hvsc", () => ({
  getHvscDurationByMd5Seconds: vi.fn(async () => null),
  getHvscDurationsByMd5Seconds: vi.fn(async () => null),
}));
vi.mock("@/lib/sid/sidUtils", () => ({
  getSidSongCount: vi.fn(() => 1),
  computeSidMd5: vi.fn(async () => "mock-md5"),
}));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/uiErrors", () => ({ reportUserError: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/config/applyConfigFileReference", () => ({
  applyConfigFileReference: vi.fn(async () => undefined),
  ensureConfigFileReferenceAccessible: vi.fn(async () => undefined),
  isConfigReferenceUnavailableError: vi.fn(() => false),
}));

const createItem = (category: PlaylistItem["category"], path: string, overrides: Partial<PlaylistItem> = {}) =>
  ({
    id: path,
    request: { source: "ultimate", path },
    category,
    label: path.split("/").pop() ?? path,
    path,
    durationMs: 60_000,
    sourceId: null,
    sizeBytes: null,
    modifiedAt: null,
    addedAt: new Date(0).toISOString(),
    status: "ready",
    unavailableReason: null,
    ...overrides,
  }) as PlaylistItem;

const renderHarness = (initialPlaylist: PlaylistItem[], initiallyPlaying = false) =>
  renderHook(() => {
    const [playlist, setPlaylist] = useState(initialPlaylist);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(initiallyPlaying);
    const [isPaused, setIsPaused] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [playedMs, setPlayedMs] = useState(0);
    const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
    const playedClockRef = useRef({
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      reset: vi.fn(),
      current: vi.fn(() => playedMs),
    });
    const enqueuePlayTransition = useCallback(async (task: () => Promise<void>) => await task(), []);
    return usePlaybackController({
      playlist,
      setPlaylist,
      currentIndex,
      setCurrentIndex,
      isPlaying,
      setIsPlaying,
      isPaused,
      setIsPaused,
      setIsPlaylistLoading: vi.fn(),
      elapsedMs,
      setElapsedMs,
      playedMs,
      setPlayedMs,
      durationMs,
      setDurationMs,
      setCurrentSubsongCount: vi.fn(),
      setTrackInstanceId: vi.fn(),
      repeatEnabled: false,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
      deviceProduct: "C64 Ultimate",
      ensurePlaybackConnection: vi.fn().mockResolvedValue(undefined),
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(null),
      applySonglengthsToItems: vi.fn().mockImplementation(async (items) => items),
      restoreVolumeOverrides: vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: vi.fn().mockResolvedValue(undefined),
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({}),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: {}, enablement: {} }),
      snapshotToUpdates: vi.fn().mockReturnValue({}),
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
      dispatchVolume: vi.fn(),
      sidEnablement: {} as never,
      pauseMuteSnapshotRef: { current: null },
      pausingFromPauseRef: { current: false },
      resumingFromPauseRef: { current: false },
      ensureUnmuted: vi.fn().mockResolvedValue(undefined),
      playedClockRef,
      trackStartedAtRef: useRef<number | null>(null),
      trackInstanceIdRef: useRef(0),
      autoAdvanceGuardRef: useRef(null),
      playStartInFlightRef: useRef(false),
      cancelAutoAdvance: vi.fn(),
      enqueuePlayTransition,
      durationSeconds: 45,
      setAutoAdvanceDueAtMs: vi.fn(),
      trace: (fn: (...args: unknown[]) => unknown) => fn,
    });
  });

const createDeviceApi = (events: string[]) => ({
  getDeviceHost: vi.fn(() => "c64u"),
  machineReset: vi.fn(async () => void events.push("reset")),
  machineReboot: vi.fn(async () => void events.push("reboot")),
  unmountDrive: vi.fn(async (drive: string) => void events.push(`eject ${drive}`)),
  mountDrive: vi.fn(async (drive: string, path: string) => void events.push(`mount ${drive} ${path}`)),
});

describe("Stop ends exactly what Play started", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    markRemotePlaybackStopped();
  });

  it("ejects the disk Play mounted after Stop's reboot and puts the user's own disk back", async () => {
    const events: string[] = [];
    vi.mocked(getC64API).mockReturnValue(createDeviceApi(events) as never);
    recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/game.d64", priorImagePath: "/USB0/mine.d64" });
    const { result } = renderHarness([createItem("disk", "/USB0/game.d64")], true);

    await act(async () => result.current.handleStop());

    expect(events).toEqual(["reboot", "eject a", "mount a /USB0/mine.d64"]);
  });

  it("ejects the disk a launch mounted after Stop had already overtaken it", async () => {
    const events: string[] = [];
    vi.mocked(getC64API).mockReturnValue(createDeviceApi(events) as never);
    let finishMount!: () => void;
    vi.mocked(executePlayPlan).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (finishMount = resolve));
      recordPlayLaunchMount("c64u", { drive: "a", launchPath: "/USB0/game.d64", priorImagePath: null });
    });
    const { result } = renderHarness([createItem("disk", "/USB0/game.d64")]);

    let launch!: Promise<void>;
    act(() => {
      launch = result.current.handlePlay();
    });
    await waitFor(() => expect(finishMount).toBeDefined());
    await act(async () => result.current.handleStop());
    expect(events).toEqual(["reboot"]);

    await act(async () => {
      finishMount();
      await launch;
    });

    expect(events).toEqual(["reboot", "reboot", "eject a"]);
  });
});

describe("Stop cancels a .cfg apply in progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    markRemotePlaybackStopped();
  });

  it("cancels the apply before Stop's reboot goes out, reports no failure, and the next start applies the .cfg again", async () => {
    const events: string[] = [];
    vi.mocked(getC64API).mockReturnValue(createDeviceApi(events) as never);
    vi.mocked(applyConfigFileReference).mockImplementationOnce(() =>
      runCancellableConfigApply(
        (signal) =>
          new Promise<void>((_, reject) => {
            events.push("apply started");
            signal.addEventListener("abort", () => {
              events.push("apply cancelled");
              reject(new ConfigApplyCancelledError("key DOWN"));
            });
          }),
      ),
    );
    const runProgram = vi.fn();
    vi.mocked(executePlayPlan).mockImplementationOnce(async (_api, _plan, options) => {
      await options?.beforeLaunch?.();
      runProgram();
    });
    const crt = createItem("crt", "/USB0/game.crt", {
      configRef: { kind: "ultimate", fileName: "game.cfg", path: "/USB0/game.cfg" },
    });
    const { result } = renderHarness([crt]);

    let launch!: Promise<void>;
    act(() => {
      launch = result.current.handlePlay();
    });
    await waitFor(() => expect(events).toContain("apply started"));
    await act(async () => result.current.handleStop());

    expect(events.slice(0, 3)).toEqual(["apply started", "apply cancelled", "reboot"]);
    await act(async () => launch);
    expect(runProgram).not.toHaveBeenCalled();
    expect(reportUserError).not.toHaveBeenCalled();

    await act(async () => result.current.playItem(crt, { playlistIndex: 0 }));
    expect(applyConfigFileReference).toHaveBeenCalledTimes(2);
  });

  it("does not start the .cfg apply when Stop arrived while the file was still being looked up", async () => {
    vi.mocked(getC64API).mockReturnValue(createDeviceApi([]) as never);
    let finishLookup!: () => void;
    vi.mocked(ensureConfigFileReferenceAccessible).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishLookup = resolve)),
    );
    const crt = createItem("crt", "/USB0/game.crt", {
      configRef: { kind: "ultimate", fileName: "game.cfg", path: "/USB0/game.cfg" },
    });
    const { result } = renderHarness([crt]);

    let launch!: Promise<void>;
    act(() => {
      launch = result.current.handlePlay();
    });
    await waitFor(() => expect(finishLookup).toBeDefined());
    await act(async () => result.current.handleStop());
    await act(async () => {
      finishLookup();
      await launch;
    });

    expect(applyConfigFileReference).not.toHaveBeenCalled();
    expect(reportUserError).not.toHaveBeenCalled();
  });
});
