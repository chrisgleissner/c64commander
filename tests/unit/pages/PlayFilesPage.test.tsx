/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PlayFilesPage from "@/pages/PlayFilesPage";

const useVolumeOverrideMock = vi.fn();
const loadVolumeSliderPreviewIntervalMsMock = vi.fn(() => 200);

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/components/AppBar", () => ({
  AppBar: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/FileOriginIcon", () => ({
  FileOriginIcon: () => <div data-testid="file-origin-icon" />,
}));

vi.mock("@/components/itemSelection/AddItemsProgressOverlay", () => ({
  AddItemsProgressOverlay: ({ visible }: { visible: boolean }) => (
    <div data-testid="add-items-overlay">{visible ? "visible" : "hidden"}</div>
  ),
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => <div data-testid="item-selection-dialog" />,
}));

vi.mock("@/pages/playFiles/components/VolumeControls", () => ({
  VolumeControls: ({ previewIntervalMs }: { previewIntervalMs: number }) => (
    <div data-testid="volume-controls-props">preview:{previewIntervalMs}</div>
  ),
}));

vi.mock("@/pages/playFiles/components/PlaybackControlsCard", () => ({
  PlaybackControlsCard: ({ volumeControls }: { volumeControls: React.ReactNode }) => (
    <div data-testid="playback-controls-card">{volumeControls}</div>
  ),
}));

vi.mock("@/pages/playFiles/components/PlaybackSettingsPanel", () => ({
  PlaybackSettingsPanel: () => <div data-testid="playback-settings-panel" />,
}));

vi.mock("@/pages/playFiles/components/PlaylistPanel", () => ({
  PlaylistPanel: () => <div data-testid="playlist-panel" />,
}));

vi.mock("@/pages/playFiles/components/HvscManager", () => ({
  HvscManager: () => <div data-testid="hvsc-manager" />,
}));

vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({
    status: {
      isConnected: false,
      isConnecting: false,
      deviceType: null,
      deviceInfo: null,
    },
  }),
  useC64UpdateConfigBatch: () => ({
    isPending: false,
  }),
  useC64ConfigItems: () => ({
    data: {},
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    flags: { hvsc_enabled: false },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useListPreviewLimit", () => ({
  useListPreviewLimit: () => ({ limit: 25 }),
}));

vi.mock("@/hooks/useLocalSources", () => ({
  useLocalSources: () => ({
    sources: [],
    addSourceFromPicker: vi.fn().mockResolvedValue(null),
    addSourceFromFiles: vi.fn(),
  }),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () =>
    Object.assign(<T extends (...args: any[]) => any>(fn: T) => fn, {
      scope: async () => undefined,
    }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: vi.fn(() => ({})),
}));

vi.mock("@/lib/navigation/navigationGuards", () => ({
  registerNavigationGuard: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  discoverConnection: vi.fn(),
  getConnectionSnapshot: vi.fn(() => ({ state: "OFFLINE_NO_DEMO" })),
}));

vi.mock("@/lib/playback/localFileBrowser", () => ({
  getParentPath: vi.fn(() => "/"),
}));

vi.mock("@/lib/playback/playlistTotals", () => ({
  calculatePlaylistTotals: vi.fn(() => ({ total: 0, remaining: 0 })),
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  createUltimateSourceLocation: vi.fn(() => ({ id: "ultimate" })),
}));

vi.mock("@/lib/sourceNavigation/hvscSourceAdapter", () => ({
  createHvscSourceLocation: vi.fn((path: string) => ({ id: `hvsc:${path}` })),
}));

vi.mock("@/lib/sourceNavigation/localSourceAdapter", () => ({
  createLocalSourceLocation: vi.fn((source: { id: string }) => source),
  resolveLocalRuntimeFile: vi.fn(),
}));

vi.mock("@/lib/sourceNavigation/paths", () => ({
  normalizeSourcePath: vi.fn((path: string) => path),
}));

vi.mock("@/lib/sourceNavigation/localSourcesStore", () => ({
  prepareDirectoryInput: vi.fn(),
}));

vi.mock("@/lib/config/sidVolumeControl", () => ({
  buildEnabledSidMuteUpdates: vi.fn(() => ({})),
}));

vi.mock("@/lib/config/appSettings", () => ({
  APP_SETTINGS_KEYS: {
    VOLUME_SLIDER_PREVIEW_INTERVAL_MS_KEY: "c64u_volume_slider_preview_interval_ms",
  },
  loadVolumeSliderPreviewIntervalMs: () => loadVolumeSliderPreviewIntervalMsMock(),
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => "web",
  isNativePlatform: () => false,
}));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    pickFile: vi.fn(),
  },
}));

vi.mock("@/lib/native/safUtils", () => ({
  redactTreeUri: vi.fn((value: string) => value),
}));

vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  startBackgroundExecution: vi.fn(),
  stopBackgroundExecution: vi.fn(),
}));

vi.mock("@/lib/native/backgroundExecution", () => ({
  BackgroundExecution: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
  },
  onBackgroundAutoSkipDue: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/pages/playFiles/hooks/useHvscLibrary", () => ({
  useHvscLibrary: () => ({
    hvscStatus: null,
    hvscRoot: { path: "/HVSC" },
    hvscLibraryAvailable: false,
    buildHvscLocalPlayFile: vi.fn(),
  }),
}));

vi.mock("@/pages/playFiles/hooks/usePlaylistListItems", () => ({
  usePlaylistListItems: vi.fn(() => []),
}));

vi.mock("@/pages/playFiles/hooks/useSonglengths", () => ({
  useSonglengths: () => ({
    songlengthsFiles: [],
    activeSonglengthsPath: null,
    songlengthsSummary: { fileName: null, sizeLabel: null, entryCount: 0, error: null },
    handleSonglengthsInput: vi.fn(),
    handleSonglengthsPicked: vi.fn(),
    applySonglengthsToItems: vi.fn(async (items: unknown[]) => items),
    resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(null),
    mergeSonglengthsFiles: vi.fn(),
    collectSonglengthsCandidates: vi.fn(() => []),
  }),
}));

vi.mock("@/pages/playFiles/hooks/usePlaybackPersistence", () => ({
  usePlaybackPersistence: vi.fn(),
}));

vi.mock("@/pages/playFiles/hooks/usePlaylistManager", () => ({
  usePlaylistManager: () => ({
    playlist: [],
    setPlaylist: vi.fn(),
    currentIndex: 0,
    setCurrentIndex: vi.fn(),
    shuffleEnabled: false,
    setShuffleEnabled: vi.fn(),
    repeatEnabled: false,
    setRepeatEnabled: vi.fn(),
    playlistTypeFilters: [],
    setPlaylistTypeFilters: vi.fn(),
    selectedPlaylistIds: new Set<string>(),
    setSelectedPlaylistIds: vi.fn(),
    isPlaylistLoading: false,
    setIsPlaylistLoading: vi.fn(),
    reshuffleActive: false,
    handleReshuffle: vi.fn(),
  }),
}));

vi.mock("@/pages/playFiles/hooks/useVolumeOverride", () => ({
  useVolumeOverride: (...args: unknown[]) => useVolumeOverrideMock(...args),
}));

vi.mock("@/pages/playFiles/hooks/useLocalEntries", () => ({
  useLocalEntries: () => ({
    localEntriesBySourceId: new Map(),
    localSourceTreeUris: new Map(),
  }),
}));

vi.mock("@/pages/playFiles/hooks/usePlaybackController", () => ({
  usePlaybackController: () => ({
    handlePrevious: vi.fn(),
    handlePlay: vi.fn(),
    handleStop: vi.fn(),
    handlePauseResume: vi.fn(),
    handleNext: vi.fn(),
    playItem: vi.fn(),
    startPlaylist: vi.fn(),
    syncPlaybackTimeline: vi.fn(),
    playlistItemDuration: vi.fn(() => 0),
  }),
}));

vi.mock("@/pages/playFiles/hooks/usePlaybackResumeTriggers", () => ({
  usePlaybackResumeTriggers: vi.fn(),
}));

vi.mock("@/pages/playFiles/playbackTraceStore", () => ({
  setPlaybackTraceSnapshot: vi.fn(),
}));

vi.mock("@/lib/playlistRepository", () => ({
  getPlaylistDataRepository: vi.fn(() => ({
    upsertTracks: vi.fn().mockResolvedValue(undefined),
    replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
    queryPlaylist: vi.fn().mockResolvedValue({ rows: [] }),
  })),
}));

vi.mock("@/pages/playFiles/handlers/addFileSelections", () => ({
  createAddFileSelectionsHandler: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}));

vi.mock("@/pages/playFiles/playbackGuards", () => ({
  resolveVolumeSyncDecision: vi.fn(() => "apply"),
}));

vi.mock("@/pages/playFiles/playFilesUtils", async () => {
  const actual = await vi.importActual<typeof import("@/pages/playFiles/playFilesUtils")>(
    "@/pages/playFiles/playFilesUtils",
  );
  return actual;
});

vi.mock("@/lib/tracing/userTrace", () => ({
  wrapUserEvent: (fn: (...args: unknown[]) => unknown) => fn,
}));

describe("PlayFilesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadVolumeSliderPreviewIntervalMsMock.mockReset();
    loadVolumeSliderPreviewIntervalMsMock.mockReturnValue(200);
    useVolumeOverrideMock.mockReturnValue({
      volumeState: { index: 0, muted: false, reason: null },
      dispatchVolume: vi.fn(),
      volumeSteps: [{ label: "0" }, { label: "5" }],
      sidEnablement: {},
      enabledSidVolumeItems: [{ name: "SID 1", value: "0", options: ["MUTED", "0", "5"] }],
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
      restoreVolumeOverrides: vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: vi.fn().mockResolvedValue(undefined),
      pauseMuteSnapshotRef: { current: null },
      pausingFromPauseRef: { current: false },
      volumeSessionActiveRef: { current: false },
      captureSidMuteSnapshot: vi.fn(() => ({ volumes: {}, enablement: {} })),
      snapshotToUpdates: vi.fn(() => ({})),
      handleVolumeLocalChange: vi.fn(),
      handleVolumeAsyncChange: vi.fn(),
      handleVolumeCommit: vi.fn().mockResolvedValue(undefined),
      handleToggleMute: vi.fn().mockResolvedValue(undefined),
      resumingFromPauseRef: { current: false },
      ensureUnmuted: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("passes the configured preview interval into volume controls and the volume hook", () => {
    render(<PlayFilesPage />);

    expect(screen.getByTestId("volume-controls-props")).toHaveTextContent("preview:200");
    expect(useVolumeOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isPlaying: false,
        isPaused: false,
        previewIntervalMs: 200,
      }),
    );
  });

  it("refreshes the preview interval when app settings broadcast an update", async () => {
    render(<PlayFilesPage />);
    loadVolumeSliderPreviewIntervalMsMock.mockReturnValue(350);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("c64u-app-settings-updated", {
          detail: { key: "c64u_volume_slider_preview_interval_ms" },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("volume-controls-props")).toHaveTextContent("preview:350");
    });
    expect(useVolumeOverrideMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previewIntervalMs: 350,
      }),
    );
  });
});
