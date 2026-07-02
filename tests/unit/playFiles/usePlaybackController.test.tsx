import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import { seededShuffleIds } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { clearArchivePlaybackCacheForTests } from "@/lib/archive/archivePlaybackCache";
import { getC64API } from "@/lib/c64api";
import { reportUserError } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { getHvscDurationByMd5Seconds } from "@/lib/hvsc";
import { applyConfigFileReference, ensureConfigFileReferenceAccessible } from "@/lib/config/applyConfigFileReference";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";

const mockArchiveClient = {
  downloadBinary: vi.fn(),
};

const mockBuildArchivePlayPlan = vi.fn();

vi.mock("@/lib/archive/client", () => ({
  createArchiveClient: vi.fn(() => mockArchiveClient),
}));

vi.mock("@/lib/archive/execution", () => ({
  buildArchivePlayPlan: vi.fn((binary) => mockBuildArchivePlayPlan(binary)),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: vi.fn(() => ({})),
}));

vi.mock("@/lib/playback/playbackRouter", () => ({
  buildPlayPlan: vi.fn((request) => request),
  executePlayPlan: vi.fn(async (_api, _plan, options) => {
    if (options?.beforeLaunch) {
      await options.beforeLaunch();
    }
  }),
  tryFetchUltimateSidBlob: vi.fn(async () => null),
}));

vi.mock("@/lib/hvsc", () => ({
  getHvscDurationByMd5Seconds: vi.fn(async () => null),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  getSidSongCount: vi.fn(() => 3),
  computeSidMd5: vi.fn(async () => "mock-md5"),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/config/applyConfigFileReference", () => ({
  applyConfigFileReference: vi.fn(async () => undefined),
  ensureConfigFileReferenceAccessible: vi.fn(async () => undefined),
  isConfigReferenceUnavailableError: vi.fn((error: unknown) =>
    Boolean((error as Error & { c64uConfigUnavailable?: boolean })?.c64uConfigUnavailable),
  ),
}));

const createPlaylistItem = (overrides: Partial<PlaylistItem> = {}): PlaylistItem => ({
  id: "item-1",
  request: {
    source: "ultimate",
    path: "/PROGRAMS/demo.prg",
  },
  category: "prg",
  label: "demo.prg",
  path: "/PROGRAMS/demo.prg",
  durationMs: undefined,
  sourceId: null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
  ...overrides,
});

const renderPlaybackController = (
  playlist: PlaylistItem[],
  options?: {
    currentIndex?: number;
    durationMs?: number;
    isPlaying?: boolean;
    isPaused?: boolean;
    repeatEnabled?: boolean;
    shuffleEnabled?: boolean;
    shuffleSeed?: number | null;
    setPlaylist?: ReturnType<typeof vi.fn>;
    setCurrentIndex?: ReturnType<typeof vi.fn>;
    setIsPlaying?: ReturnType<typeof vi.fn>;
    setIsPaused?: ReturnType<typeof vi.fn>;
    setIsPlaylistLoading?: ReturnType<typeof vi.fn>;
    setElapsedMs?: ReturnType<typeof vi.fn>;
    setPlayedMs?: ReturnType<typeof vi.fn>;
    setDurationMs?: ReturnType<typeof vi.fn>;
    setCurrentSubsongCount?: ReturnType<typeof vi.fn>;
    setTrackInstanceId?: ReturnType<typeof vi.fn>;
    setAutoAdvanceDueAtMs?: ReturnType<typeof vi.fn>;
    ensurePlaybackConnection?: ReturnType<typeof vi.fn>;
    ensureUnmuted?: ReturnType<typeof vi.fn>;
    applyAudioMixerUpdates?: ReturnType<typeof vi.fn>;
    restoreVolumeOverrides?: ReturnType<typeof vi.fn>;
    dispatchVolume?: ReturnType<typeof vi.fn>;
    resolveEnabledSidVolumeItems?: ReturnType<typeof vi.fn>;
    enabledSidVolumeItems?: Array<{ name: string; value: string; options?: string[] }>;
    pauseMuteSnapshotRef?: { current: any };
    pausingFromPauseRef?: { current: boolean };
    resumingFromPauseRef?: { current: boolean };
    trackStartedAtRef?: { current: number | null };
    trackInstanceIdRef?: { current: number };
    autoAdvanceGuardRef?: { current: any };
    playStartInFlightRef?: { current: boolean };
    playedClockRef?: {
      current: {
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        pause: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
        reset: ReturnType<typeof vi.fn>;
        current: ReturnType<typeof vi.fn>;
      };
    };
    captureSidMuteSnapshot?: ReturnType<typeof vi.fn>;
    buildEnabledSidMuteUpdates?: ReturnType<typeof vi.fn>;
    applySonglengthsToItems?: ReturnType<typeof vi.fn>;
    cancelAutoAdvance?: ReturnType<typeof vi.fn>;
    enqueuePlayTransition?: ReturnType<typeof vi.fn>;
    resolveSonglengthDurationMsForPath?: ReturnType<typeof vi.fn>;
    snapshotToUpdates?: ReturnType<typeof vi.fn>;
    archiveConfigs?: Record<string, { id: string; name: string; baseUrl: string; enabled: boolean }>;
    resolveUnavailableConfigDecision?: ReturnType<typeof vi.fn>;
    buildHvscLocalPlayFile?: ReturnType<typeof vi.fn>;
    deviceProduct?: string | null;
  },
) =>
  renderHook(() =>
    usePlaybackController({
      playlist,
      setPlaylist: options?.setPlaylist ?? vi.fn(),
      currentIndex: options?.currentIndex ?? 0,
      setCurrentIndex: options?.setCurrentIndex ?? vi.fn(),
      isPlaying: options?.isPlaying ?? false,
      setIsPlaying: options?.setIsPlaying ?? vi.fn(),
      isPaused: options?.isPaused ?? false,
      setIsPaused: options?.setIsPaused ?? vi.fn(),
      setIsPlaylistLoading: options?.setIsPlaylistLoading ?? vi.fn(),
      elapsedMs: 0,
      setElapsedMs: options?.setElapsedMs ?? vi.fn(),
      playedMs: 0,
      setPlayedMs: options?.setPlayedMs ?? vi.fn(),
      durationMs: options?.durationMs,
      setDurationMs: options?.setDurationMs ?? vi.fn(),
      setCurrentSubsongCount: options?.setCurrentSubsongCount ?? vi.fn(),
      repeatEnabled: options?.repeatEnabled ?? false,
      shuffleEnabled: options?.shuffleEnabled ?? false,
      shuffleSeed: options?.shuffleSeed ?? null,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
      buildHvscLocalPlayFile: options?.buildHvscLocalPlayFile,
      deviceProduct: options?.deviceProduct ?? "Ultimate 64 Elite",
      ensurePlaybackConnection: options?.ensurePlaybackConnection ?? vi.fn().mockResolvedValue(undefined),
      resolveUnavailableConfigDecision: options?.resolveUnavailableConfigDecision,
      resolveSonglengthDurationMsForPath:
        options?.resolveSonglengthDurationMsForPath ?? vi.fn().mockResolvedValue(null),
      applySonglengthsToItems: options?.applySonglengthsToItems ?? vi.fn().mockImplementation(async (items) => items),
      archiveConfigs: options?.archiveConfigs,
      restoreVolumeOverrides: options?.restoreVolumeOverrides ?? vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: options?.applyAudioMixerUpdates ?? vi.fn().mockResolvedValue(undefined),
      enabledSidVolumeItems: options?.enabledSidVolumeItems ?? [],
      buildEnabledSidMuteUpdates: options?.buildEnabledSidMuteUpdates ?? vi.fn().mockReturnValue({}),
      captureSidMuteSnapshot:
        options?.captureSidMuteSnapshot ?? vi.fn().mockReturnValue({ volumes: {}, enablement: {} }),
      snapshotToUpdates: options?.snapshotToUpdates ?? vi.fn().mockReturnValue({}),
      resolveEnabledSidVolumeItems: options?.resolveEnabledSidVolumeItems ?? vi.fn().mockResolvedValue([]),
      dispatchVolume: options?.dispatchVolume ?? vi.fn(),
      sidEnablement: {} as any,
      pauseMuteSnapshotRef: options?.pauseMuteSnapshotRef ?? { current: null },
      pausingFromPauseRef: options?.pausingFromPauseRef ?? { current: false },
      resumingFromPauseRef: options?.resumingFromPauseRef ?? { current: false },
      playedClockRef:
        options?.playedClockRef ??
        ({
          current: {
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            reset: vi.fn(),
            current: vi.fn().mockReturnValue(0),
          },
        } as const),
      trackStartedAtRef: options?.trackStartedAtRef ?? { current: null },
      trackInstanceIdRef: options?.trackInstanceIdRef ?? { current: 0 },
      autoAdvanceGuardRef: options?.autoAdvanceGuardRef ?? { current: null },
      playStartInFlightRef: options?.playStartInFlightRef ?? { current: false },
      cancelAutoAdvance: options?.cancelAutoAdvance ?? vi.fn(),
      enqueuePlayTransition: options?.enqueuePlayTransition ?? vi.fn().mockImplementation(async (task) => task()),
      durationSeconds: 45,
      trace: (fn: (...args: unknown[]) => unknown) => fn,
      setTrackInstanceId: options?.setTrackInstanceId ?? vi.fn(),
      setAutoAdvanceDueAtMs: options?.setAutoAdvanceDueAtMs ?? vi.fn(),
      ensureUnmuted: options?.ensureUnmuted ?? vi.fn().mockResolvedValue(undefined),
    }),
  );

describe("usePlaybackController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearArchivePlaybackCacheForTests();
    pollingPauseRegistry.__resetForTest();
    mockArchiveClient.downloadBinary.mockResolvedValue({
      fileName: "joyride.sid",
      bytes: new Uint8Array([0x50, 0x53, 0x49, 0x44]),
      contentType: "application/octet-stream",
      url: "http://commoserve/files/joyride.sid",
    });
    mockBuildArchivePlayPlan.mockImplementation((binary) => ({
      category: "sid",
      source: "local",
      path: binary.fileName,
      file: {
        name: binary.fileName,
        lastModified: 0,
        arrayBuffer: vi.fn(async () => binary.bytes.buffer.slice(0)),
      },
    }));
  });

  it("applies fallback duration for non-song playlist rows before playback starts", () => {
    const playlist = [createPlaylistItem()];
    const { result } = renderPlaybackController(playlist);

    expect(result.current.playlistItemDuration(playlist[0], 0)).toBe(45_000);
  });

  it("returns early from pause-resume when playback is inactive", async () => {
    const playlist = [createPlaylistItem()];
    const machineResume = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineResume } as any);
    const { result } = renderPlaybackController(playlist, { isPlaying: false, isPaused: false });

    await result.current.handlePauseResume();

    expect(machineResume).not.toHaveBeenCalled();
  });

  it("preserves explicit duration for non-song items", () => {
    const playlist = [createPlaylistItem({ durationMs: 12_000 })];
    const { result } = renderPlaybackController(playlist);

    expect(result.current.playlistItemDuration(playlist[0], 0)).toBe(12_000);
  });

  it("applies fallback duration when non-song playback starts", async () => {
    const playlist = [createPlaylistItem()];
    const setPlaylist = vi.fn();
    const setDurationMs = vi.fn();
    const { result } = renderPlaybackController(playlist, { setPlaylist, setDurationMs });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(setDurationMs).toHaveBeenCalledWith(45_000);
    const playlistUpdaters = setPlaylist.mock.calls
      .map(([value]) => value)
      .filter((value): value is (items: PlaylistItem[]) => PlaylistItem[] => typeof value === "function");
    const playlistUpdater = playlistUpdaters[playlistUpdaters.length - 1];
    expect(playlistUpdater).toBeDefined();
    const nextPlaylist = playlistUpdater?.(playlist);
    expect(nextPlaylist?.[0]?.durationMs).toBe(45_000);
  });

  it("does not update track timeline or playlist metadata when launch fails", async () => {
    const playlist = [createPlaylistItem()];
    const setPlaylist = vi.fn();
    const setElapsedMs = vi.fn();
    const setDurationMs = vi.fn();
    const setCurrentSubsongCount = vi.fn();
    const setIsPlaying = vi.fn();
    vi.mocked(executePlayPlan).mockRejectedValueOnce(new Error("launch failed"));
    const { result } = renderPlaybackController(playlist, {
      setPlaylist,
      setElapsedMs,
      setDurationMs,
      setCurrentSubsongCount,
      setIsPlaying,
    });

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow("launch failed");

    expect(setElapsedMs).not.toHaveBeenCalledWith(0);
    expect(setDurationMs).not.toHaveBeenCalled();
    expect(setCurrentSubsongCount).not.toHaveBeenCalled();
    expect(setPlaylist).not.toHaveBeenCalled();
    expect(setIsPlaying).not.toHaveBeenCalledWith(true);
  });

  it("preserves imported HVSC SID duration and subsong metadata in the play request", async () => {
    const hvscFile = {
      name: "demo.sid",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    };
    const playlist = [
      createPlaylistItem({
        category: "sid",
        label: "demo.sid",
        path: "/MUSICIANS/Test/demo.sid",
        request: {
          source: "hvsc",
          path: "/MUSICIANS/Test/demo.sid",
          file: hvscFile as any,
          songNr: 2,
        },
        durationMs: 12_000,
        subsongCount: 4,
        sourceId: "hvsc-library",
      }),
    ];
    const setCurrentSubsongCount = vi.fn();
    const setDurationMs = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      setCurrentSubsongCount,
      setDurationMs,
    });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(hvscFile.arrayBuffer).not.toHaveBeenCalled();
    expect(setCurrentSubsongCount).toHaveBeenCalledWith(4);
    expect(setDurationMs).toHaveBeenCalledWith(12_000);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "hvsc",
        path: "/MUSICIANS/Test/demo.sid",
        songNr: 2,
        durationMs: 12_000,
      }),
      expect.objectContaining({}),
    );
  });

  it("logs structured playback request details for HVSC items before execution", async () => {
    const hvscFile = {
      name: "demo.sid",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    };
    const playlist = [
      createPlaylistItem({
        id: "hvsc-item-1",
        category: "sid",
        label: "demo.sid",
        path: "/MUSICIANS/Test/demo.sid",
        request: {
          source: "hvsc",
          path: "/MUSICIANS/Test/demo.sid",
          file: hvscFile as any,
          songNr: 2,
        },
        durationMs: 12_000,
        subsongCount: 4,
        sourceId: "hvsc-library",
      }),
    ];
    const { result } = renderPlaybackController(playlist);

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "info",
      "Playback request started",
      expect.objectContaining({
        itemId: "hvsc-item-1",
        label: "demo.sid",
        category: "sid",
        source: "hvsc",
        sourceId: "hvsc-library",
        path: "/MUSICIANS/Test/demo.sid",
        songNr: 2,
        durationMs: 12_000,
      }),
    );
  });

  it("propagates songlength via SSL upload for ultimate SID playback instead of skipping it", async () => {
    const playlist = [
      createPlaylistItem({
        category: "sid",
        label: "10_Orbyte.sid",
        path: "/USB2/test-data/SID/10_Orbyte.sid",
        request: {
          source: "ultimate",
          path: "/USB2/test-data/SID/10_Orbyte.sid",
          songNr: 1,
        },
        durationMs: 77_000,
        subsongCount: 1,
      }),
    ];
    const { result } = renderPlaybackController(playlist);

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    const [, plan, options] = vi.mocked(executePlayPlan).mock.calls[0];
    expect(plan).toMatchObject({
      source: "ultimate",
      path: "/USB2/test-data/SID/10_Orbyte.sid",
      durationMs: 77_000,
    });
    // The device only learns the true song length when the SID is sent as a
    // REST payload with the SSL songlength attached (duration-propagation contract).
    expect((options as { skipSidSslPropagation?: boolean } | undefined)?.skipSidSslPropagation).toBeUndefined();
  });

  it("reports a play start superseded by a routing change as a notice, not a destructive error", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    vi.mocked(executePlayPlan).mockRejectedValueOnce(abortError);
    const setIsPlaying = vi.fn();
    const { result } = renderPlaybackController(playlist, { currentIndex: 0, setIsPlaying });

    await result.current.handlePlay();

    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYBACK_START",
        title: "Playback interrupted",
        severity: "S2",
      }),
    );
    expect(vi.mocked(reportUserError)).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Playback failed" }));
    expect(setIsPlaying).not.toHaveBeenCalledWith(true);
  });

  it("downloads CommoServe playlist items lazily when playback starts", async () => {
    const playlist = [
      createPlaylistItem({
        id: "archive-item-1",
        category: "sid",
        label: "Joyride",
        path: "joyride.sid",
        request: {
          source: "commoserve",
          path: "joyride.sid",
        },
        sourceId: "archive-commoserve",
        archiveRef: {
          sourceId: "archive-commoserve",
          resultId: "100",
          category: 40,
          entryId: 1,
          entryPath: "joyride.sid",
        },
      }),
    ];
    const { result } = renderPlaybackController(playlist, {
      archiveConfigs: {
        "archive-commoserve": {
          id: "archive-commoserve",
          name: "CommoServe",
          baseUrl: "http://commoserve.files.commodore.net",
          enabled: true,
        },
      },
    });

    expect(mockArchiveClient.downloadBinary).not.toHaveBeenCalled();

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(mockArchiveClient.downloadBinary).toHaveBeenCalledWith("100", 40, 1, "joyride.sid");
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "commoserve",
        path: "joyride.sid",
        file: expect.objectContaining({ name: "joyride.sid" }),
      }),
      expect.objectContaining({}),
    );
  });

  it("reuses cached CommoServe runtime files across playback attempts", async () => {
    const archiveRef = {
      sourceId: "archive-commoserve",
      resultId: "100",
      category: 40,
      entryId: 1,
      entryPath: "joyride.sid",
    };
    const firstItem = createPlaylistItem({
      id: "archive-item-1",
      category: "sid",
      label: "Joyride",
      path: "joyride.sid",
      request: {
        source: "commoserve",
        path: "joyride.sid",
      },
      sourceId: "archive-commoserve",
      archiveRef,
    });
    const secondItem = createPlaylistItem({
      id: "archive-item-2",
      category: "sid",
      label: "Joyride Again",
      path: "joyride.sid",
      request: {
        source: "commoserve",
        path: "joyride.sid",
      },
      sourceId: "archive-commoserve",
      archiveRef,
    });
    const archiveConfigs = {
      "archive-commoserve": {
        id: "archive-commoserve",
        name: "CommoServe",
        baseUrl: "http://commoserve.files.commodore.net",
        enabled: true,
      },
    };
    const { result } = renderPlaybackController([firstItem, secondItem], { archiveConfigs });

    await result.current.playItem(firstItem, { playlistIndex: 0 });
    await result.current.playItem(secondItem, { playlistIndex: 1 });

    expect(mockArchiveClient.downloadBinary).toHaveBeenCalledTimes(1);
  });

  it("normalizes extensionless archive entry path through playlist state after download succeeds", async () => {
    mockArchiveClient.downloadBinary.mockResolvedValueOnce({
      fileName: "joyride",
      bytes: new Uint8Array([0x50, 0x53, 0x49, 0x44]),
      contentType: "application/octet-stream",
      url: "http://commoserve/files/joyride",
    });
    mockBuildArchivePlayPlan.mockReturnValueOnce({
      category: "sid",
      source: "local",
      path: "joyride.sid",
      file: { name: "joyride.sid", lastModified: 0, arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) },
    });
    const item = createPlaylistItem({
      id: "archive-extensionless",
      category: "sid",
      label: "Joyride",
      path: "joyride",
      request: { source: "commoserve", path: "joyride" },
      sourceId: "archive-commoserve",
      archiveRef: {
        sourceId: "archive-commoserve",
        resultId: "100",
        category: 40,
        entryId: 1,
        entryPath: "joyride",
      },
    });
    const setPlaylist = vi.fn();
    const { result } = renderPlaybackController([item], {
      setPlaylist,
      archiveConfigs: {
        "archive-commoserve": {
          id: "archive-commoserve",
          name: "CommoServe",
          baseUrl: "http://commoserve.files.commodore.net",
          enabled: true,
        },
      },
    });

    await result.current.playItem(item, { playlistIndex: 0 });

    expect(item.request.path).toBe("joyride");
    expect(item.path).toBe("joyride");
    const playlistUpdaters = setPlaylist.mock.calls
      .map(([value]) => value)
      .filter((value): value is (items: PlaylistItem[]) => PlaylistItem[] => typeof value === "function");
    const playlistUpdater = playlistUpdaters[playlistUpdaters.length - 1];
    const nextPlaylist = playlistUpdater?.([item]);
    expect(nextPlaylist?.[0]?.request.path).toBe("joyride.sid");
    expect(nextPlaylist?.[0]?.path).toBe("joyride.sid");
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "joyride.sid" }),
      expect.objectContaining({}),
    );
  });

  it("normalizes extensionless archive entry path through playlist state on cache hit", async () => {
    mockArchiveClient.downloadBinary.mockResolvedValueOnce({
      fileName: "joyride",
      bytes: new Uint8Array([0x50, 0x53, 0x49, 0x44]),
      contentType: "application/octet-stream",
      url: "http://commoserve/files/joyride",
    });
    mockBuildArchivePlayPlan.mockReturnValueOnce({
      category: "sid",
      source: "local",
      path: "joyride.sid",
      file: { name: "joyride.sid", lastModified: 0, arrayBuffer: vi.fn(async () => new ArrayBuffer(4)) },
    });
    const archiveRef = {
      sourceId: "archive-commoserve",
      resultId: "100",
      category: 40,
      entryId: 1,
      entryPath: "joyride",
    };
    const archiveConfigs = {
      "archive-commoserve": {
        id: "archive-commoserve",
        name: "CommoServe",
        baseUrl: "http://commoserve.files.commodore.net",
        enabled: true,
      },
    };
    const firstItem = createPlaylistItem({
      id: "archive-ext-1",
      category: "sid",
      label: "Joyride",
      path: "joyride",
      request: { source: "commoserve", path: "joyride" },
      sourceId: "archive-commoserve",
      archiveRef,
    });
    const secondItem = createPlaylistItem({
      id: "archive-ext-2",
      category: "sid",
      label: "Joyride Again",
      path: "joyride",
      request: { source: "commoserve", path: "joyride" },
      sourceId: "archive-commoserve",
      archiveRef,
    });
    const setPlaylist = vi.fn();
    const { result } = renderPlaybackController([firstItem, secondItem], { archiveConfigs, setPlaylist });

    await result.current.playItem(firstItem, { playlistIndex: 0 });
    await result.current.playItem(secondItem, { playlistIndex: 1 });

    expect(mockArchiveClient.downloadBinary).toHaveBeenCalledTimes(1);
    expect(secondItem.request.path).toBe("joyride");
    expect(secondItem.path).toBe("joyride");
    const playlistUpdaters = setPlaylist.mock.calls
      .map(([value]) => value)
      .filter((value): value is (items: PlaylistItem[]) => PlaylistItem[] => typeof value === "function");
    const playlistUpdater = playlistUpdaters[playlistUpdaters.length - 1];
    const nextPlaylist = playlistUpdater?.([firstItem, secondItem]);
    expect(nextPlaylist?.[1]?.request.path).toBe("joyride.sid");
    expect(nextPlaylist?.[1]?.path).toBe("joyride.sid");
  });

  it("reports an archive playback error when playlist metadata is missing", async () => {
    const playlist = [
      createPlaylistItem({
        id: "archive-item-missing-ref",
        category: "sid",
        label: "Broken Archive Row",
        path: "joyride.sid",
        request: {
          source: "commoserve",
          path: "joyride.sid",
        },
        sourceId: "archive-commoserve",
        archiveRef: null,
      }),
    ];
    const { result } = renderPlaybackController(playlist, {
      archiveConfigs: {
        "archive-commoserve": {
          id: "archive-commoserve",
          name: "CommoServe",
          baseUrl: "http://commoserve.files.commodore.net",
          enabled: true,
        },
      },
    });

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow(
      "Archive item metadata is missing. Re-add it to the playlist.",
    );
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYBACK_ARCHIVE_RESOLVE",
        title: "Archive playback unavailable",
        description: "Archive item metadata is missing. Re-add it to the playlist.",
      }),
    );
  });

  it("reports an archive playback error when the source config is unavailable", async () => {
    const playlist = [
      createPlaylistItem({
        id: "archive-item-missing-config",
        category: "sid",
        label: "Configless Archive Row",
        path: "joyride.sid",
        request: {
          source: "commoserve",
          path: "joyride.sid",
        },
        sourceId: "archive-commoserve",
        archiveRef: {
          sourceId: "archive-commoserve",
          resultId: "100",
          category: 40,
          entryId: 1,
          entryPath: "joyride.sid",
        },
      }),
    ];
    const { result } = renderPlaybackController(playlist);

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow(
      "Archive source configuration unavailable for archive-commoserve.",
    );
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYBACK_ARCHIVE_RESOLVE",
        description: "Archive source configuration unavailable for archive-commoserve.",
      }),
    );
    expect(mockArchiveClient.downloadBinary).not.toHaveBeenCalled();
  });

  it("marks archive resolution failures as handled so playback start shows only one user-facing error", async () => {
    const visibleReports: Array<{ operation: string; title: string; description: string }> = [];
    vi.mocked(reportUserError).mockImplementation((report) => {
      const handled = (report.error as { c64uHandled?: boolean } | undefined)?.c64uHandled;
      if (handled) {
        return;
      }
      visibleReports.push({
        operation: report.operation,
        title: report.title,
        description: report.description,
      });
      if (report.error instanceof Error) {
        (report.error as Error & { c64uHandled?: boolean }).c64uHandled = true;
      }
    });

    const playlist = [
      createPlaylistItem({
        id: "archive-item-missing-ref",
        category: "sid",
        label: "Broken Archive Row",
        path: "joyride.sid",
        request: {
          source: "commoserve",
          path: "joyride.sid",
        },
        sourceId: "archive-commoserve",
        archiveRef: null,
      }),
    ];
    const { result } = renderPlaybackController(playlist, {
      archiveConfigs: {
        "archive-commoserve": {
          id: "archive-commoserve",
          name: "CommoServe",
          baseUrl: "http://commoserve.files.commodore.net",
          enabled: true,
        },
      },
    });

    await result.current.handlePlay();

    expect(visibleReports).toEqual([
      {
        operation: "PLAYBACK_ARCHIVE_RESOLVE",
        title: "Archive playback unavailable",
        description: "Archive item metadata is missing. Re-add it to the playlist.",
      },
    ]);
  });

  it("reports an archive playback error when the resolved archive file is not playable", async () => {
    mockBuildArchivePlayPlan.mockReturnValueOnce({
      category: "sid",
      source: "local",
      path: "joyride.sid",
      file: undefined,
    });
    const playlist = [
      createPlaylistItem({
        id: "archive-item-unplayable",
        category: "sid",
        label: "Unreadable Archive Row",
        path: "joyride.sid",
        request: {
          source: "commoserve",
          path: "joyride.sid",
        },
        sourceId: "archive-commoserve",
        archiveRef: {
          sourceId: "archive-commoserve",
          resultId: "100",
          category: 40,
          entryId: 1,
          entryPath: "joyride.sid",
        },
      }),
    ];
    const { result } = renderPlaybackController(playlist, {
      archiveConfigs: {
        "archive-commoserve": {
          id: "archive-commoserve",
          name: "CommoServe",
          baseUrl: "http://commoserve.files.commodore.net",
          enabled: true,
        },
      },
    });

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow(
      "Archive entry joyride.sid did not resolve to a playable file.",
    );
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYBACK_ARCHIVE_RESOLVE",
        description: "Archive entry joyride.sid did not resolve to a playable file.",
      }),
    );
  });

  it("proves playback connection before refreshing mute state and executing the play plan", async () => {
    const playlist = [createPlaylistItem()];
    const ensureUnmuted = vi.fn().mockResolvedValue(undefined);
    const ensurePlaybackConnection = vi.fn().mockResolvedValue(undefined);
    const { result } = renderPlaybackController(playlist, { ensurePlaybackConnection, ensureUnmuted });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(ensureUnmuted).toHaveBeenCalledTimes(1);
    expect(ensureUnmuted).toHaveBeenCalledWith({ refreshItems: true });
    expect(ensurePlaybackConnection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    expect(ensurePlaybackConnection.mock.invocationCallOrder[0]).toBeLessThan(
      ensureUnmuted.mock.invocationCallOrder[0],
    );
    expect(ensureUnmuted.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(executePlayPlan).mock.invocationCallOrder[0],
    );
  });

  it("passes playback config through the playback beforeLaunch phase", async () => {
    const playlist = [
      createPlaylistItem({
        configRef: {
          kind: "ultimate",
          fileName: "demo.cfg",
          path: "/USB1/test-data/snapshots/demo.cfg",
        },
      }),
    ];
    const ensureUnmuted = vi.fn().mockResolvedValue(undefined);
    const ensurePlaybackConnection = vi.fn().mockResolvedValue(undefined);
    const { result } = renderPlaybackController(playlist, { ensurePlaybackConnection, ensureUnmuted });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(vi.mocked(applyConfigFileReference)).toHaveBeenCalledWith(
      expect.objectContaining({
        configRef: playlist[0].configRef,
        deviceProduct: "Ultimate 64 Elite",
      }),
    );
    expect(vi.mocked(ensureConfigFileReferenceAccessible)).toHaveBeenCalledWith(
      expect.objectContaining({
        configRef: playlist[0].configRef,
      }),
    );
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "/PROGRAMS/demo.prg" }),
      expect.objectContaining({ beforeLaunch: expect.any(Function) }),
    );
    expect(ensurePlaybackConnection.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(executePlayPlan).mock.invocationCallOrder[0],
    );
  });

  it("fails playback start when the beforeLaunch playback config application fails", async () => {
    vi.mocked(applyConfigFileReference).mockRejectedValueOnce(new Error("config apply failed"));
    const playlist = [
      createPlaylistItem({
        configRef: {
          kind: "ultimate",
          fileName: "demo.cfg",
          path: "/USB1/test-data/snapshots/demo.cfg",
        },
      }),
    ];
    const { result } = renderPlaybackController(playlist);

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow("config apply failed");
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYBACK_CONFIG_APPLY",
        title: "Config application failed",
        description: "config apply failed",
      }),
    );
  });

  it("allows playback to continue without config when the config file is unavailable and the user declines it for the session", async () => {
    const unavailableError = Object.assign(new Error("Config file demo.cfg is unavailable."), {
      c64uConfigUnavailable: true,
    });
    vi.mocked(ensureConfigFileReferenceAccessible).mockRejectedValueOnce(unavailableError);
    const resolveUnavailableConfigDecision = vi.fn().mockResolvedValue("play-without-config");
    const playlist = [
      createPlaylistItem({
        configRef: {
          kind: "ultimate",
          fileName: "demo.cfg",
          path: "/USB1/test-data/snapshots/demo.cfg",
        },
      }),
    ];
    const { result } = renderPlaybackController(playlist, { resolveUnavailableConfigDecision });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(resolveUnavailableConfigDecision).toHaveBeenCalledWith(
      playlist[0],
      expect.objectContaining({
        configFileName: "demo.cfg",
      }),
    );
    expect(vi.mocked(applyConfigFileReference)).not.toHaveBeenCalled();
    expect(vi.mocked(reportUserError)).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_CONFIG_APPLY" }),
    );
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("fails playback start when unmuting before playback start fails", async () => {
    const playlist = [createPlaylistItem()];
    const ensureUnmuted = vi.fn().mockRejectedValue(new Error("unmute failed"));
    const { result } = renderPlaybackController(playlist, { ensureUnmuted });

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow("unmute failed");
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("resumes paused playback before restoring the pre-pause SID mixer volume", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const callOrder: string[] = [];
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const pauseMuteSnapshotRef = {
      current: {
        volumes: { "SID 1": "0 dB" },
        enablement: {},
      },
    };
    const snapshotToUpdates = vi.fn().mockReturnValue({ "SID 1": "0 dB" });
    vi.mocked(getC64API).mockReturnValue({
      machineResume: vi.fn(async () => {
        callOrder.push("resume");
      }),
    } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: true,
      applyAudioMixerUpdates,
      pauseMuteSnapshotRef,
      enabledSidVolumeItems: [{ name: "SID 1", value: "-42 dB" }],
      snapshotToUpdates,
    });

    applyAudioMixerUpdates.mockImplementation(async () => {
      callOrder.push("unmute");
    });

    await result.current.handlePauseResume();

    expect(callOrder).toEqual(["resume", "unmute"]);
    expect(applyAudioMixerUpdates).toHaveBeenCalledWith({ "SID 1": "0 dB" }, "Resume unmute");
    expect(pauseMuteSnapshotRef.current).toBeNull();
  });

  it("mutes enabled SID mixer volume before pausing active playback", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const callOrder: string[] = [];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const machinePause = vi.fn(async () => {
      callOrder.push("pause");
    });
    vi.mocked(getC64API).mockReturnValue({ machinePause } as any);
    const pauseMuteSnapshotRef = { current: null };
    applyAudioMixerUpdates.mockImplementation(async () => {
      callOrder.push("mute");
    });

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
      dispatchVolume,
      applyAudioMixerUpdates,
      enabledSidVolumeItems: [{ name: "SID 1", value: "0 dB", options: ["-42 dB", "0 dB"] }],
      pauseMuteSnapshotRef,
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({ "SID 1": "-42 dB" }),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: { "SID 1": "0 dB" }, enablement: {} }),
    });

    await result.current.handlePauseResume();

    expect(callOrder).toEqual(["mute", "pause"]);
    expect(machinePause).toHaveBeenCalled();
    expect(applyAudioMixerUpdates).toHaveBeenCalledWith({ "SID 1": "-42 dB" }, "Pause mute");
    expect(dispatchVolume).toHaveBeenCalledWith({ type: "mute", reason: "pause" });
    expect(pauseMuteSnapshotRef.current).toEqual({ volumes: { "SID 1": "0 dB" }, enablement: {} });
  });

  it("restores the pause mute snapshot when machine pause fails after muting", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const machinePause = vi.fn().mockRejectedValue(new Error("pause failed"));
    vi.mocked(getC64API).mockReturnValue({ machinePause } as any);
    const pauseMuteSnapshotRef = { current: null };
    const pausingFromPauseRef = { current: false };
    const resumingFromPauseRef = { current: false };
    const snapshotToUpdates = vi.fn().mockReturnValue({ "SID 1": "0 dB" });

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
      dispatchVolume,
      applyAudioMixerUpdates,
      enabledSidVolumeItems: [{ name: "SID 1", value: "0 dB", options: ["-42 dB", "0 dB"] }],
      pauseMuteSnapshotRef,
      pausingFromPauseRef,
      resumingFromPauseRef,
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({ "SID 1": "-42 dB" }),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: { "SID 1": "0 dB" }, enablement: {} }),
      snapshotToUpdates,
    });

    await result.current.handlePauseResume();

    expect(applyAudioMixerUpdates).toHaveBeenNthCalledWith(1, { "SID 1": "-42 dB" }, "Pause mute");
    expect(applyAudioMixerUpdates).toHaveBeenNthCalledWith(2, { "SID 1": "0 dB" }, "Pause mute rollback");
    expect(dispatchVolume).toHaveBeenCalledWith({ type: "mute", reason: "pause" });
    expect(dispatchVolume).toHaveBeenCalledWith({ type: "unmute", reason: "pause" });
    expect(pauseMuteSnapshotRef.current).toBeNull();
    expect(pausingFromPauseRef.current).toBe(false);
    expect(resumingFromPauseRef.current).toBe(false);
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Playback control failed",
        description: "pause failed",
      }),
    );
  });

  it("resumes a DMA-paused machine before playing a new track (HARD9-029)", async () => {
    const playlist = [createPlaylistItem()];
    const machineResume = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineResume } as any);

    const { result } = renderPlaybackController(playlist, { isPaused: true });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(machineResume).toHaveBeenCalled();
  });

  it("does not attempt to resume when the machine was not paused", async () => {
    const playlist = [createPlaylistItem()];
    const machineResume = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineResume } as any);

    const { result } = renderPlaybackController(playlist, { isPaused: false });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(machineResume).not.toHaveBeenCalled();
  });

  it("aborts the new-track launch and reports an error if resuming from pause fails (HARD9-029)", async () => {
    const playlist = [createPlaylistItem()];
    const machineResume = vi.fn().mockRejectedValue(new Error("resume failed"));
    vi.mocked(getC64API).mockReturnValue({ machineResume } as any);

    const { result } = renderPlaybackController(playlist, { isPaused: true });

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow("resume failed");

    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYBACK_RESUME",
        title: "Resume failed",
        description: "resume failed",
      }),
    );
  });

  it("clears stale pause-mute bookkeeping refs when starting a new track (HARD9-063)", async () => {
    const playlist = [createPlaylistItem()];
    const pauseMuteSnapshotRef = { current: { volumes: { "SID 1": "0 dB" }, enablement: {} } as any };
    const pausingFromPauseRef = { current: true };
    const resumingFromPauseRef = { current: true };

    const { result } = renderPlaybackController(playlist, {
      isPaused: false,
      pauseMuteSnapshotRef,
      pausingFromPauseRef,
      resumingFromPauseRef,
    });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(pauseMuteSnapshotRef.current).toBeNull();
    expect(pausingFromPauseRef.current).toBe(false);
    expect(resumingFromPauseRef.current).toBe(false);
  });

  it("pauses without mixer writes when no enabled SID outputs are active", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const machinePause = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machinePause } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
      dispatchVolume,
      applyAudioMixerUpdates,
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
    });

    await result.current.handlePauseResume();

    expect(machinePause).toHaveBeenCalled();
    expect(applyAudioMixerUpdates).not.toHaveBeenCalled();
    expect(dispatchVolume).not.toHaveBeenCalled();
  });

  it("pauses using cached SID mixer items without forcing fresh config reads", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const machinePause = vi.fn().mockResolvedValue(undefined);
    const resolveEnabledSidVolumeItems = vi.fn().mockRejectedValue(new Error("fresh config read should not run"));
    vi.mocked(getC64API).mockReturnValue({ machinePause } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      dispatchVolume,
      applyAudioMixerUpdates,
      resolveEnabledSidVolumeItems,
      enabledSidVolumeItems: [{ name: "SID 1", value: "0 dB", options: ["-42 dB", "0 dB"] }],
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({ "SID 1": "-42 dB" }),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: { "SID 1": "0 dB" }, enablement: {} }),
    });

    await result.current.handlePauseResume();

    expect(machinePause).toHaveBeenCalled();
    expect(dispatchVolume).toHaveBeenCalledWith({ type: "mute", reason: "pause" });
    expect(applyAudioMixerUpdates).toHaveBeenCalledWith({ "SID 1": "-42 dB" }, "Pause mute");
    expect(resolveEnabledSidVolumeItems).not.toHaveBeenCalled();
  });

  it("prevents duplicate play starts while a single-flight request is already active", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaylistLoading = vi.fn();
    const playStartInFlightRef = { current: true };
    const { result } = renderPlaybackController(playlist, {
      setIsPlaylistLoading,
      playStartInFlightRef,
    });

    await result.current.handlePlay();

    expect(setIsPlaylistLoading).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("drops a duplicate startPlaylist while a start is already in flight", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaylistLoading = vi.fn();
    const playStartInFlightRef = { current: true };
    const { result } = renderPlaybackController(playlist, {
      setIsPlaylistLoading,
      playStartInFlightRef,
    });

    await result.current.startPlaylist(playlist, 0);

    expect(setIsPlaylistLoading).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("releases the startPlaylist single-flight guard so a later start succeeds", async () => {
    const playlist = [createPlaylistItem()];
    const playStartInFlightRef = { current: false };
    const { result } = renderPlaybackController(playlist, {
      playStartInFlightRef,
    });

    await result.current.startPlaylist(playlist, 0);

    expect(playStartInFlightRef.current).toBe(false);
    await result.current.startPlaylist(playlist, 0);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(2);
  });

  it("cancels the previous track's auto-advance guard before a playlist row start", async () => {
    // Regression: a paused session kept its overdue auto-advance guard; a row
    // tap (startPlaylist) flipped isPaused false without cancelling it, so
    // timeline reconciliation fired the stale guard and started the previous
    // playlist's next item (machine reboot included) over the fresh start.
    const playlist = [createPlaylistItem()];
    const cancelAutoAdvance = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      cancelAutoAdvance,
    });

    await result.current.startPlaylist(playlist, 0);

    expect(cancelAutoAdvance).toHaveBeenCalled();
    const cancelOrder = cancelAutoAdvance.mock.invocationCallOrder[0];
    const playOrder = vi.mocked(executePlayPlan).mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(playOrder);
  });

  it("merges resolved playlist entries with existing extras when starting playback", async () => {
    const resolvedItems = [
      createPlaylistItem({ id: "resolved-1", label: "resolved-1.prg", path: "/PROGRAMS/resolved-1.prg" }),
    ];
    const extraItem = createPlaylistItem({ id: "extra-1", label: "extra-1.prg", path: "/PROGRAMS/extra-1.prg" });
    const setPlaylist = vi.fn();
    const applySonglengthsToItems = vi.fn().mockResolvedValue(resolvedItems);
    const { result } = renderPlaybackController(resolvedItems, {
      setPlaylist,
      applySonglengthsToItems,
    });

    await result.current.startPlaylist(resolvedItems, 0);

    const mergeUpdater = setPlaylist.mock.calls.find(([value]) => typeof value === "function")?.[0] as
      ((items: PlaylistItem[]) => PlaylistItem[]) | undefined;
    expect(mergeUpdater).toBeDefined();
    expect(mergeUpdater?.([extraItem])).toEqual([...resolvedItems, extraItem]);
  });

  it("reports playback start failures from startPlaylist and clears loading state", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setIsPlaylistLoading = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const ensureUnmuted = vi.fn().mockRejectedValue(new Error("unmute failed"));
    const trackStartedAtRef = { current: 1234 };
    const autoAdvanceGuardRef = { current: { trackInstanceId: 1 } };
    const { result } = renderPlaybackController(playlist, {
      setIsPlaying,
      setIsPaused,
      setIsPlaylistLoading,
      setAutoAdvanceDueAtMs,
      ensureUnmuted,
      trackStartedAtRef,
      autoAdvanceGuardRef,
    });

    await result.current.startPlaylist(playlist, 0);

    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_START", title: "Playback failed" }),
    );
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(trackStartedAtRef.current).toBeNull();
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
    expect(setIsPlaylistLoading).toHaveBeenLastCalledWith(false);
  });

  it("resumes before stopping paused disk playback and reboots the machine", async () => {
    const playlist = [
      createPlaylistItem({ category: "disk", request: { source: "ultimate", path: "/DISKS/demo.d64" } }),
    ];
    const machineResume = vi.fn().mockResolvedValue(undefined);
    const machineReboot = vi.fn().mockResolvedValue(undefined);
    const restoreVolumeOverrides = vi.fn().mockResolvedValue(undefined);
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(0),
      },
    };
    const setPlayedMs = vi.fn();
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setElapsedMs = vi.fn();
    const setDurationMs = vi.fn();
    const setCurrentSubsongCount = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const trackStartedAtRef = { current: 1234 };
    const autoAdvanceGuardRef = { current: { trackInstanceId: 1 } };
    vi.mocked(getC64API).mockReturnValue({ machineResume, machineReboot } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: true,
      restoreVolumeOverrides,
      playedClockRef,
      setPlayedMs,
      setIsPlaying,
      setIsPaused,
      setElapsedMs,
      setDurationMs,
      setCurrentSubsongCount,
      setAutoAdvanceDueAtMs,
      trackStartedAtRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleStop();

    expect(machineResume).toHaveBeenCalled();
    expect(machineReboot).toHaveBeenCalled();
    expect(restoreVolumeOverrides).toHaveBeenCalledWith("stop");
    expect(playedClockRef.current.stop).toHaveBeenCalled();
    expect(setPlayedMs).toHaveBeenCalledWith(0);
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(setElapsedMs).toHaveBeenCalledWith(0);
    expect(setDurationMs).toHaveBeenCalledWith(undefined);
    expect(setCurrentSubsongCount).toHaveBeenCalledWith(null);
    expect(trackStartedAtRef.current).toBeNull();
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
  });

  it("stops auto-advance at the end of the playlist when repeat is disabled", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 4,
        dueAtMs: 10_000,
        autoFired: false,
        userCancelled: false,
      },
    };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setIsPlaying,
      setIsPaused,
      setPlayedMs,
      setAutoAdvanceDueAtMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 4);

    expect(playedClockRef.current.pause).toHaveBeenCalled();
    expect(setPlayedMs).toHaveBeenCalledWith(2500);
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("ignores stale auto-advance callbacks when the track instance no longer matches", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 2,
        dueAtMs: 10_000,
        autoFired: false,
        userCancelled: false,
      },
    };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setPlayedMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 999);

    expect(playedClockRef.current.pause).not.toHaveBeenCalled();
    expect(setPlayedMs).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    expect(autoAdvanceGuardRef.current.autoFired).toBe(false);
  });

  it("ignores auto-advance callbacks once the guard has already auto-fired", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 2,
        dueAtMs: 10_000,
        autoFired: true,
        userCancelled: false,
      },
    };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setPlayedMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 2);

    expect(playedClockRef.current.pause).not.toHaveBeenCalled();
    expect(setPlayedMs).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("ignores auto-advance callbacks after the user cancels auto-advance", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 2,
        dueAtMs: 10_000,
        autoFired: false,
        userCancelled: true,
      },
    };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setPlayedMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 2);

    expect(playedClockRef.current.pause).not.toHaveBeenCalled();
    expect(setPlayedMs).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("ignores auto-advance callbacks when no guard is active", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = { current: null };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setPlayedMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 2);

    expect(playedClockRef.current.pause).not.toHaveBeenCalled();
    expect(setPlayedMs).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("reports previous-track failures and clears playback state", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const setPlayedMs = vi.fn();
    const cancelAutoAdvance = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(900),
      },
    };
    const trackStartedAtRef = { current: 1234 };
    const autoAdvanceGuardRef = { current: { trackInstanceId: 1 } };
    const ensureUnmuted = vi.fn().mockRejectedValue(new Error("unmute failed"));

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 1,
      isPlaying: true,
      setIsPlaying,
      setIsPaused,
      setAutoAdvanceDueAtMs,
      setPlayedMs,
      cancelAutoAdvance,
      playedClockRef,
      trackStartedAtRef,
      autoAdvanceGuardRef,
      ensureUnmuted,
    });

    await result.current.handlePrevious();

    expect(cancelAutoAdvance).toHaveBeenCalled();
    expect(playedClockRef.current.pause).toHaveBeenCalled();
    expect(setPlayedMs).toHaveBeenCalledWith(900);
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_PREVIOUS", title: "Playback previous failed" }),
    );
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(trackStartedAtRef.current).toBeNull();
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
  });

  it("falls back when local SID metadata cannot read the file", async () => {
    const { result } = renderPlaybackController([createPlaylistItem()]);
    const brokenFile = {
      name: "broken.sid",
      arrayBuffer: vi.fn().mockRejectedValue(new Error("read failed")),
    } as unknown as File;

    await expect(result.current.resolveSidMetadata(brokenFile as any, 1)).resolves.toEqual({
      durationMs: 45_000,
      subsongCount: undefined,
      readable: false,
    });
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "Failed to read local SID file",
      expect.objectContaining({ error: "read failed" }),
    );
  });

  it("resolves local SID metadata from songlength lookup before MD5 lookup", async () => {
    const file = {
      name: "demo.sid",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as File;
    const { result } = renderPlaybackController([createPlaylistItem()], {
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(12_345) as any,
    } as any);

    await expect(result.current.resolveSidMetadata(file as any, 2)).resolves.toEqual({
      durationMs: 12_345,
      subsongCount: 3,
      readable: true,
    });
    expect(vi.mocked(getHvscDurationByMd5Seconds)).not.toHaveBeenCalled();
  });

  it("falls back to HVSC MD5 duration lookup for local SID metadata", async () => {
    vi.mocked(getHvscDurationByMd5Seconds).mockResolvedValueOnce(99);
    const file = {
      name: "demo.sid",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as File;
    const { result } = renderPlaybackController([createPlaylistItem()]);

    await expect(result.current.resolveSidMetadata(file as any, null)).resolves.toEqual({
      durationMs: 99_000,
      subsongCount: 3,
      readable: true,
    });
  });

  it("preserves explicit local SID duration overrides while backfilling missing subsong metadata", async () => {
    const file = {
      name: "demo.sid",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as unknown as File;
    const setCurrentSubsongCount = vi.fn();
    const localSid = createPlaylistItem({
      category: "sid",
      label: "demo.sid",
      path: "/MUSIC/demo.sid",
      sourceId: "local-1",
      durationMs: 12_000,
      subsongCount: undefined,
      request: { source: "local", path: "/MUSIC/demo.sid", file },
    });
    const { result } = renderPlaybackController([localSid], {
      setCurrentSubsongCount,
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(180_000) as any,
    } as any);

    await result.current.playItem(localSid, { playlistIndex: 0 });

    expect(setCurrentSubsongCount).toHaveBeenCalledWith(3);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "local",
        path: "/MUSIC/demo.sid",
        file,
        durationMs: 12_000,
      }),
      expect.anything(),
    );
  });

  it("throws when a local playlist item cannot be resolved to a file", async () => {
    const localItem = createPlaylistItem({
      category: "sid",
      sourceId: "local-1",
      path: "/MUSIC/demo.sid",
      request: { source: "local", path: "/MUSIC/demo.sid", file: undefined },
    });
    const { result } = renderPlaybackController([localItem]);

    await expect(result.current.playItem(localItem, { playlistIndex: 0 })).rejects.toThrow(
      "Local file unavailable. Re-add it to the playlist.",
    );
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("lazily resolves HVSC files only when playback starts", async () => {
    const hvscFile = {
      name: "demo.sid",
      webkitRelativePath: "/MUSICIANS/Test/demo.sid",
      lastModified: 0,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    };
    const buildHvscLocalPlayFile = vi.fn(() => hvscFile as any);
    const hvscItem = createPlaylistItem({
      category: "sid",
      label: "demo.sid",
      path: "/MUSICIANS/Test/demo.sid",
      request: { source: "hvsc", path: "/MUSICIANS/Test/demo.sid" },
      sourceId: "hvsc-library",
      durationMs: 1_000,
      subsongCount: 1,
    });
    const setPlaylist = vi.fn();
    const { result } = renderPlaybackController([hvscItem], { buildHvscLocalPlayFile, setPlaylist });

    await result.current.playItem(hvscItem, { playlistIndex: 0 });

    expect(buildHvscLocalPlayFile).toHaveBeenCalledWith("/MUSICIANS/Test/demo.sid", "demo.sid");
    expect(hvscItem.request.file).toBeUndefined();
    const playlistUpdaters = setPlaylist.mock.calls
      .map(([value]) => value)
      .filter((value): value is (items: PlaylistItem[]) => PlaylistItem[] => typeof value === "function");
    const playlistUpdater = playlistUpdaters[playlistUpdaters.length - 1];
    expect(playlistUpdater?.([hvscItem])?.[0]?.request.file).toBe(hvscFile);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "hvsc",
        path: "/MUSICIANS/Test/demo.sid",
        file: hvscFile,
      }),
      expect.anything(),
    );
  });

  it("resolves HVSC runtime files when top-level playlist play starts from an unset current index", async () => {
    const hvscFile = {
      name: "demo.sid",
      webkitRelativePath: "/MUSICIANS/Test/demo.sid",
      lastModified: 0,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    };
    const buildHvscLocalPlayFile = vi.fn(() => hvscFile as any);
    const hvscItem = createPlaylistItem({
      category: "sid",
      label: "demo.sid",
      path: "/MUSICIANS/Test/demo.sid",
      request: { source: "hvsc", path: "/MUSICIANS/Test/demo.sid" },
      sourceId: "hvsc-library",
      durationMs: 1_000,
      subsongCount: 1,
    });
    const setIsPlaylistLoading = vi.fn();
    const setPlaylist = vi.fn();
    const { result } = renderPlaybackController([hvscItem], {
      currentIndex: -1,
      buildHvscLocalPlayFile,
      setIsPlaylistLoading,
      setPlaylist,
    });

    await result.current.handlePlay();

    expect(buildHvscLocalPlayFile).toHaveBeenCalledWith("/MUSICIANS/Test/demo.sid", "demo.sid");
    expect(hvscItem.request.file).toBeUndefined();
    const playlistUpdaters = setPlaylist.mock.calls
      .map(([value]) => value)
      .filter((value): value is (items: PlaylistItem[]) => PlaylistItem[] => typeof value === "function");
    const playlistUpdater = playlistUpdaters[playlistUpdaters.length - 1];
    expect(playlistUpdater?.([hvscItem])?.[0]?.request.file).toBe(hvscFile);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "hvsc",
        path: "/MUSICIANS/Test/demo.sid",
        file: hvscFile,
      }),
      expect.anything(),
    );
    expect(setIsPlaylistLoading).toHaveBeenLastCalledWith(false);
  });

  it("reports connection failures before playback starts", async () => {
    const item = createPlaylistItem();
    const ensurePlaybackConnection = vi.fn().mockRejectedValue(new Error("connect failed"));
    const ensureUnmuted = vi.fn().mockResolvedValue(undefined);
    const { result } = renderPlaybackController([item], { ensurePlaybackConnection, ensureUnmuted });

    await expect(result.current.playItem(item, { playlistIndex: 0 })).rejects.toThrow("connect failed");
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_CONNECT", title: "Connection failed" }),
    );
    expect(ensureUnmuted).not.toHaveBeenCalled();
  });

  it("starts the playlist from scratch when the current index is unset", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaylistLoading = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      currentIndex: -1,
      setIsPlaylistLoading,
    });

    await result.current.handlePlay();

    expect(setIsPlaylistLoading).toHaveBeenCalledWith(true);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("does nothing when stop is requested while playback is already inactive", async () => {
    const machineReset = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineReset } as any);
    const { result } = renderPlaybackController([createPlaylistItem()], { isPlaying: false, isPaused: false });

    await result.current.handleStop();

    expect(machineReset).not.toHaveBeenCalled();
  });

  it("reports reset failures when stopping non-disk playback", async () => {
    const machineReset = vi.fn().mockRejectedValue(new Error("reset failed"));
    const restoreVolumeOverrides = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineReset } as any);
    const { result } = renderPlaybackController([createPlaylistItem()], {
      isPlaying: true,
      restoreVolumeOverrides,
    });

    await result.current.handleStop();

    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_STOP", title: "Stop failed" }),
    );
    expect(restoreVolumeOverrides).toHaveBeenCalledWith("stop");
  });

  it("allows a queued machine reset to finish without emitting a false stop failure", async () => {
    vi.useFakeTimers();
    try {
      const machineReset = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 3500);
          }),
      );
      const restoreVolumeOverrides = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getC64API).mockReturnValue({ machineReset } as any);
      const { result } = renderPlaybackController([createPlaylistItem()], {
        isPlaying: true,
        restoreVolumeOverrides,
      });

      const stopPromise = result.current.handleStop();
      await vi.advanceTimersByTimeAsync(3500);
      await stopPromise;

      expect(vi.mocked(reportUserError)).not.toHaveBeenCalled();
      expect(restoreVolumeOverrides).toHaveBeenCalledWith("stop");
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows a queued machine reboot to finish without emitting a false stop failure", async () => {
    vi.useFakeTimers();
    try {
      const machineReboot = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 3500);
          }),
      );
      const restoreVolumeOverrides = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getC64API).mockReturnValue({ machineReboot } as any);
      const { result } = renderPlaybackController([createPlaylistItem({ category: "disk" })], {
        isPlaying: true,
        restoreVolumeOverrides,
      });

      const stopPromise = result.current.handleStop();
      await vi.advanceTimersByTimeAsync(3500);
      await stopPromise;

      expect(vi.mocked(reportUserError)).not.toHaveBeenCalled();
      expect(restoreVolumeOverrides).toHaveBeenCalledWith("stop");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears local stop state before delayed volume restoration completes", async () => {
    vi.useFakeTimers();
    try {
      const machineReset = vi.fn().mockResolvedValue(undefined);
      let resolveRestoreVolume!: () => void;
      const restoreVolumeDeferred = new Promise<void>((resolve) => {
        resolveRestoreVolume = resolve;
      });
      const restoreVolumeOverrides = vi.fn().mockReturnValue(restoreVolumeDeferred);
      const setPlayedMs = vi.fn();
      const setIsPlaying = vi.fn();
      const setIsPaused = vi.fn();
      const setElapsedMs = vi.fn();
      const setDurationMs = vi.fn();
      const setCurrentSubsongCount = vi.fn();
      const setAutoAdvanceDueAtMs = vi.fn();
      const playedClockRef = {
        current: {
          start: vi.fn(),
          stop: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          reset: vi.fn(),
          current: vi.fn().mockReturnValue(0),
        },
      } as const;

      vi.mocked(getC64API).mockReturnValue({ machineReset } as any);
      const { result } = renderPlaybackController([createPlaylistItem()], {
        isPlaying: true,
        restoreVolumeOverrides,
        setPlayedMs,
        setIsPlaying,
        setIsPaused,
        setElapsedMs,
        setDurationMs,
        setCurrentSubsongCount,
        setAutoAdvanceDueAtMs,
        playedClockRef,
      });

      const stopPromise = result.current.handleStop();
      await vi.advanceTimersByTimeAsync(3500);

      expect(machineReset).toHaveBeenCalledTimes(1);
      expect(restoreVolumeOverrides).toHaveBeenCalledWith("stop");
      expect(playedClockRef.current.stop).toHaveBeenCalledTimes(1);
      expect(setPlayedMs).toHaveBeenCalledWith(0);
      expect(setIsPlaying).toHaveBeenCalledWith(false);
      expect(setIsPaused).toHaveBeenCalledWith(false);
      expect(setElapsedMs).toHaveBeenCalledWith(0);
      expect(setDurationMs).toHaveBeenCalledWith(undefined);
      expect(setCurrentSubsongCount).toHaveBeenCalledWith(null);
      expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);

      resolveRestoreVolume();
      await stopPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs unexpected restore failures after stop without leaving playback active", async () => {
    const machineReset = vi.fn().mockResolvedValue(undefined);
    const restoreVolumeOverrides = vi.fn().mockRejectedValue(new Error("restore failed"));
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setElapsedMs = vi.fn();

    vi.mocked(getC64API).mockReturnValue({ machineReset } as any);
    const { result } = renderPlaybackController([createPlaylistItem()], {
      isPlaying: true,
      restoreVolumeOverrides,
      setIsPlaying,
      setIsPaused,
      setElapsedMs,
    });

    await result.current.handleStop();

    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(setElapsedMs).toHaveBeenCalledWith(0);
    expect(addErrorLog).toHaveBeenCalledWith(
      "Playback stop volume restore failed",
      expect.objectContaining({ error: "restore failed" }),
    );
  });

  it("retries resume before unmuting paused playback", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const machineResume = vi.fn().mockRejectedValueOnce(new Error("resume once")).mockResolvedValueOnce(undefined);
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const pauseMuteSnapshotRef = {
      current: {
        volumes: { "SID 1": "5 dB" },
        enablement: {},
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 1,
        dueAtMs: 0,
        autoFired: false,
        userCancelled: false,
      },
    };
    const setAutoAdvanceDueAtMs = vi.fn();
    vi.mocked(getC64API).mockReturnValue({ machineResume } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: true,
      elapsedMs: 0 as any,
      durationMs: 30_000,
      applyAudioMixerUpdates,
      resolveEnabledSidVolumeItems: vi
        .fn()
        .mockResolvedValue([{ name: "SID 1", value: "0 dB", options: ["OFF", "-42 dB", "5 dB"] }]),
      snapshotToUpdates: vi.fn().mockReturnValue({ "SID 1": "5 dB" }) as any,
      pauseMuteSnapshotRef,
      autoAdvanceGuardRef,
      setAutoAdvanceDueAtMs,
    } as any);

    await result.current.handlePauseResume();

    expect(machineResume).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "Machine resume first attempt failed",
      expect.objectContaining({ error: "resume once" }),
    );
    expect(applyAudioMixerUpdates).toHaveBeenCalledWith({ "SID 1": "5 dB" }, "Resume unmute");
    const lastResumeOrder = machineResume.mock.invocationCallOrder[machineResume.mock.invocationCallOrder.length - 1];
    expect(lastResumeOrder).toBeLessThan(applyAudioMixerUpdates.mock.invocationCallOrder[0]);
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalled();
  });

  it("does not issue SID mixer writes during pause resume toggles", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const machinePause = vi.fn().mockResolvedValue(undefined);
    const machineResume = vi.fn().mockResolvedValue(undefined);
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API)
      .mockReturnValueOnce({ machinePause } as any)
      .mockReturnValueOnce({ machineResume } as any);

    const pauseRender = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
      applyAudioMixerUpdates,
    });

    await pauseRender.result.current.handlePauseResume();

    const resumeRender = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: true,
      applyAudioMixerUpdates,
    });

    await resumeRender.result.current.handlePauseResume();

    expect(machinePause).toHaveBeenCalledTimes(1);
    expect(machineResume).toHaveBeenCalledTimes(1);
    expect(applyAudioMixerUpdates).not.toHaveBeenCalled();
  });

  it("pauses background polling while pause or resume requests are in flight", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    let resolvePause: (() => void) | null = null;
    const machinePause = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePause = resolve;
        }),
    );
    vi.mocked(getC64API).mockReturnValue({ machinePause } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
    });

    const pending = result.current.handlePauseResume();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);

    resolvePause?.();
    await pending;

    expect(machinePause).toHaveBeenCalledTimes(1);
    expect(pollingPauseRegistry.isPollingPaused()).toBe(false);
  });

  it("wraps to the first playlist item when repeat is enabled", async () => {
    const playlist = [
      createPlaylistItem({ id: "item-1", label: "one.prg", path: "/PROGRAMS/one.prg" }),
      createPlaylistItem({ id: "item-2", label: "two.prg", path: "/PROGRAMS/two.prg" }),
    ];
    const setCurrentIndex = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      currentIndex: 1,
      isPlaying: true,
      repeatEnabled: true,
      setCurrentIndex,
    });

    await result.current.handleNext("user");

    expect(setCurrentIndex).toHaveBeenCalledWith(0);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("wraps previous to the last playlist item when repeat is enabled", async () => {
    const playlist = [
      createPlaylistItem({ id: "item-1", label: "one.prg", path: "/PROGRAMS/one.prg" }),
      createPlaylistItem({ id: "item-2", label: "two.prg", path: "/PROGRAMS/two.prg" }),
    ];
    const setCurrentIndex = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      repeatEnabled: true,
      setCurrentIndex,
    });

    await result.current.handlePrevious();

    expect(setCurrentIndex).toHaveBeenCalledWith(1);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("handleNext walks the shuffled order instead of the curated array order when shuffle is enabled (HARD9-007)", async () => {
    const playlist = [
      createPlaylistItem({ id: "item-1", label: "one.prg", path: "/PROGRAMS/one.prg" }),
      createPlaylistItem({ id: "item-2", label: "two.prg", path: "/PROGRAMS/two.prg" }),
      createPlaylistItem({ id: "item-3", label: "three.prg", path: "/PROGRAMS/three.prg" }),
    ];
    const seed = 4242;
    const order = seededShuffleIds(
      playlist.map((item) => item.id),
      seed,
    );
    const startIndex = playlist.findIndex((item) => item.id === order[0]);
    const expectedNextIndex = playlist.findIndex((item) => item.id === order[1]);
    const setCurrentIndex = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      currentIndex: startIndex,
      isPlaying: true,
      shuffleEnabled: true,
      shuffleSeed: seed,
      setCurrentIndex,
    });

    await result.current.handleNext("user");

    expect(setCurrentIndex).toHaveBeenCalledWith(expectedNextIndex);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("handlePrevious walks the shuffled order backward when shuffle is enabled (HARD9-007)", async () => {
    const playlist = [
      createPlaylistItem({ id: "item-1", label: "one.prg", path: "/PROGRAMS/one.prg" }),
      createPlaylistItem({ id: "item-2", label: "two.prg", path: "/PROGRAMS/two.prg" }),
      createPlaylistItem({ id: "item-3", label: "three.prg", path: "/PROGRAMS/three.prg" }),
    ];
    const seed = 4242;
    const order = seededShuffleIds(
      playlist.map((item) => item.id),
      seed,
    );
    const startIndex = playlist.findIndex((item) => item.id === order[1]);
    const expectedPrevIndex = playlist.findIndex((item) => item.id === order[0]);
    const setCurrentIndex = vi.fn();
    const { result } = renderPlaybackController(playlist, {
      currentIndex: startIndex,
      isPlaying: true,
      shuffleEnabled: true,
      shuffleSeed: seed,
      setCurrentIndex,
    });

    await result.current.handlePrevious();

    expect(setCurrentIndex).toHaveBeenCalledWith(expectedPrevIndex);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("does not reorder the curated playlist when shuffle-walking to the next track", async () => {
    const playlist = [
      createPlaylistItem({ id: "item-1", label: "one.prg", path: "/PROGRAMS/one.prg" }),
      createPlaylistItem({ id: "item-2", label: "two.prg", path: "/PROGRAMS/two.prg" }),
      createPlaylistItem({ id: "item-3", label: "three.prg", path: "/PROGRAMS/three.prg" }),
    ];
    const originalOrder = playlist.map((item) => item.id);
    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      shuffleEnabled: true,
      shuffleSeed: 4242,
    });

    await result.current.handleNext("user");

    expect(playlist.map((item) => item.id)).toEqual(originalOrder);
  });
});
