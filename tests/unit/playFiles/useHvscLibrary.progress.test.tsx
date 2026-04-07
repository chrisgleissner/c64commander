/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHvscLibrary } from "@/pages/playFiles/hooks/useHvscLibrary";

const mocks = vi.hoisted(() => ({
  toastMock: vi.fn(),
  addErrorLogMock: vi.fn(),
  addLogMock: vi.fn(),
  reportUserErrorMock: vi.fn(),
  createActionContextMock: vi.fn(() => ({})),
  runWithActionTraceMock: vi.fn(async (_context, fn) => await fn()),
  addHvscProgressListenerMock: vi.fn(),
  cancelHvscInstallMock: vi.fn(),
  checkForHvscUpdatesMock: vi.fn(),
  clearHvscStatusSummaryMock: vi.fn(),
  getDefaultHvscStatusSummaryMock: vi.fn(),
  getHvscCacheStatusMock: vi.fn(),
  getHvscFolderListingMock: vi.fn(),
  ensureHvscMetadataHydrationMock: vi.fn(),
  getHvscSongMock: vi.fn(),
  getHvscStatusMock: vi.fn(),
  loadHvscRootMock: vi.fn(),
  loadHvscStatusSummaryMock: vi.fn(),
  saveHvscStatusSummaryMock: vi.fn(),
  ingestCachedHvscMock: vi.fn(),
  installOrUpdateHvscMock: vi.fn(),
  isHvscBridgeAvailableMock: vi.fn(),
  recoverStaleIngestionStateMock: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => mocks.toastMock(...args),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => mocks.addErrorLogMock(...args),
  addLog: (...args: unknown[]) => mocks.addLogMock(...args),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: (...args: unknown[]) => mocks.reportUserErrorMock(...args),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: (...args: unknown[]) => mocks.createActionContextMock(...args),
  runWithActionTrace: (...args: unknown[]) => mocks.runWithActionTraceMock(...args),
}));

vi.mock("@/lib/hvsc", () => ({
  addHvscProgressListener: (...args: unknown[]) => mocks.addHvscProgressListenerMock(...args),
  cancelHvscInstall: (...args: unknown[]) => mocks.cancelHvscInstallMock(...args),
  checkForHvscUpdates: (...args: unknown[]) => mocks.checkForHvscUpdatesMock(...args),
  clearHvscStatusSummary: (...args: unknown[]) => mocks.clearHvscStatusSummaryMock(...args),
  ensureHvscMetadataHydration: (...args: unknown[]) => mocks.ensureHvscMetadataHydrationMock(...args),
  getDefaultHvscStatusSummary: (...args: unknown[]) => mocks.getDefaultHvscStatusSummaryMock(...args),
  getHvscCacheStatus: (...args: unknown[]) => mocks.getHvscCacheStatusMock(...args),
  getHvscFolderListing: (...args: unknown[]) => mocks.getHvscFolderListingMock(...args),
  getHvscSong: (...args: unknown[]) => mocks.getHvscSongMock(...args),
  getHvscStatus: (...args: unknown[]) => mocks.getHvscStatusMock(...args),
  loadHvscRoot: (...args: unknown[]) => mocks.loadHvscRootMock(...args),
  loadHvscStatusSummary: (...args: unknown[]) => mocks.loadHvscStatusSummaryMock(...args),
  saveHvscStatusSummary: (...args: unknown[]) => mocks.saveHvscStatusSummaryMock(...args),
  ingestCachedHvsc: (...args: unknown[]) => mocks.ingestCachedHvscMock(...args),
  installOrUpdateHvsc: (...args: unknown[]) => mocks.installOrUpdateHvscMock(...args),
  isHvscBridgeAvailable: (...args: unknown[]) => mocks.isHvscBridgeAvailableMock(...args),
  recoverStaleIngestionState: (...args: unknown[]) => mocks.recoverStaleIngestionStateMock(...args),
}));

type SummaryStatus = "idle" | "in-progress" | "success" | "failure";

const createSummary = (
  overrides: Partial<{
    download: Record<string, unknown>;
    extraction: Record<string, unknown>;
    metadata: Record<string, unknown>;
    lastUpdatedAt: string | null;
  }> = {},
) => ({
  download: {
    status: "idle" as SummaryStatus,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    errorCategory: null,
    errorMessage: null,
    downloadedBytes: null,
    totalBytes: null,
    sizeBytes: null,
    ...overrides.download,
  },
  extraction: {
    status: "idle" as SummaryStatus,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    errorCategory: null,
    errorMessage: null,
    filesExtracted: null,
    totalFiles: null,
    ...overrides.extraction,
  },
  metadata: {
    status: "idle" as SummaryStatus,
    stateToken: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    processedSongs: null,
    totalSongs: null,
    percent: null,
    lastFile: null,
    errorCount: null,
    errorMessage: null,
    ...overrides.metadata,
  },
  lastUpdatedAt: null,
  ...overrides,
});

const createStatus = (
  overrides: Partial<{
    installedVersion: number;
    ingestionState: string;
    ingestionError: string | null;
    ingestionSummary: {
      totalSongs: number;
      ingestedSongs: number;
      failedSongs: number;
      songlengthSyntaxErrors: number;
    } | null;
  }> = {},
) => ({
  installedVersion: 0,
  ingestionState: "idle",
  ingestionError: null,
  ingestionSummary: null,
  ...overrides,
});

describe("useHvscLibrary progress coverage", () => {
  let progressListener: ((event: Record<string, unknown>) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    progressListener = null;
    mocks.addHvscProgressListenerMock.mockImplementation((listener: (event: Record<string, unknown>) => void) => {
      progressListener = listener;
      return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) });
    });
    mocks.cancelHvscInstallMock.mockResolvedValue(undefined);
    mocks.checkForHvscUpdatesMock.mockResolvedValue({ latestVersion: 85, installedVersion: 0, requiredUpdates: [85] });
    mocks.clearHvscStatusSummaryMock.mockResolvedValue(undefined);
    mocks.getDefaultHvscStatusSummaryMock.mockImplementation(() => createSummary());
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: null, updateVersions: [] });
    mocks.getHvscFolderListingMock.mockResolvedValue({ path: "/", folders: [], songs: [] });
    mocks.ensureHvscMetadataHydrationMock.mockResolvedValue(undefined);
    mocks.getHvscStatusMock.mockResolvedValue(createStatus());
    mocks.loadHvscRootMock.mockReturnValue({ ready: false });
    mocks.loadHvscStatusSummaryMock.mockImplementation(() => createSummary());
    mocks.ingestCachedHvscMock.mockResolvedValue(undefined);
    mocks.installOrUpdateHvscMock.mockResolvedValue(undefined);
    mocks.isHvscBridgeAvailableMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards download progress events into the derived UI state", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "download",
        percent: 25,
        downloadedBytes: 250,
        totalBytes: 1000,
        elapsedTimeMs: 500,
        currentFile: "HVSC.7z",
        message: "Downloading HVSC…",
      });
    });

    await waitFor(() => expect(result.current.hvscDownloadStatus).toBe("in-progress"));
    expect(result.current.hvscStage).toBe("download");
    expect(result.current.hvscActionLabel).toBe("Downloading HVSC…");
    expect(result.current.hvscCurrentFile).toBe("HVSC.7z");
    expect(result.current.hvscDownloadPercent).toBe(25);
    expect(result.current.hvscDownloadBytes).toBe(250);
    expect(result.current.hvscDownloadTotalBytes).toBe(1000);
    expect(result.current.hvscPhase).toBe("download");
  });

  it("reflects download, extraction, indexing, and ready phases during install", async () => {
    let resolveInstall: (() => void) | null = null;
    mocks.installOrUpdateHvscMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    mocks.getHvscStatusMock
      .mockResolvedValueOnce(createStatus())
      .mockResolvedValueOnce(createStatus({ installedVersion: 85 }));

    const { result } = renderHook(() => useHvscLibrary());
    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      void result.current.handleHvscInstall();
    });

    await waitFor(() => expect(result.current.hvscPhase).toBe("download"));

    act(() => {
      progressListener?.({
        stage: "archive_extraction",
        percent: 40,
        processedCount: 4,
        totalCount: 10,
        elapsedTimeMs: 1500,
        message: "Extracting archive",
      });
    });
    await waitFor(() => expect(result.current.hvscPhase).toBe("extract"));

    act(() => {
      progressListener?.({
        stage: "songlengths",
        percent: 70,
        processedCount: 7,
        totalCount: 10,
        elapsedTimeMs: 2200,
        message: "Building media index",
      });
    });
    await waitFor(() => expect(result.current.hvscPhase).toBe("index"));

    act(() => {
      progressListener?.({ stage: "complete", message: "Done" });
      resolveInstall?.();
    });

    await waitFor(() => expect(result.current.hvscPhase).toBe("ready"));
    expect(result.current.hvscSummaryState).toBe("success");
    expect(result.current.hvscExtractionStatus).toBe("success");
  });

  it("surfaces metadata hydration progress in the shared HVSC state", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 85, ingestionState: "ready" }));

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "sid_metadata_hydration",
        statusToken: "running",
        processedCount: 12,
        totalCount: 60,
        percent: 20,
        message: "HVSC META 12/60 running",
      });
    });

    await waitFor(() => expect(result.current.hvscPhase).toBe("index"));
    expect(result.current.hvscMetadataProgressLabel).toBe("HVSC META 12/60 running");
  });

  it("resets to idle on cancel and ignores throttled progress that arrives afterwards", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await Promise.resolve();
    });
    expect(progressListener).not.toBeNull();

    act(() => {
      progressListener?.({
        stage: "download",
        percent: 10,
        downloadedBytes: 10,
        totalBytes: 100,
        elapsedTimeMs: 100,
        message: "Downloading HVSC",
      });
    });
    expect(result.current.hvscDownloadStatus).toBe("in-progress");

    act(() => {
      progressListener?.({
        stage: "download",
        percent: 75,
        downloadedBytes: 75,
        totalBytes: 100,
        elapsedTimeMs: 200,
        message: "Still downloading",
      });
    });

    await act(async () => {
      await result.current.handleHvscCancel();
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.hvscDownloadStatus).toBe("idle");
    expect(result.current.hvscExtractionStatus).toBe("idle");
    expect(result.current.hvscDownloadPercent).toBeNull();
    expect(result.current.hvscStage).toBeNull();

    act(() => {
      progressListener?.({
        stage: "download",
        percent: 90,
        downloadedBytes: 90,
        totalBytes: 100,
        elapsedTimeMs: 250,
        message: "Late event",
      });
      vi.advanceTimersByTime(200);
    });

    expect(result.current.hvscDownloadStatus).toBe("idle");
    expect(result.current.hvscDownloadPercent).toBeNull();
    expect(result.current.hvscActionLabel).toBeNull();
  });

  it("shows update-in-progress state when required updates are available", async () => {
    let resolveInstall: (() => void) | null = null;
    mocks.checkForHvscUpdatesMock.mockResolvedValue({ latestVersion: 85, installedVersion: 84, requiredUpdates: [85] });
    mocks.installOrUpdateHvscMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    mocks.getHvscStatusMock
      .mockResolvedValueOnce(createStatus({ installedVersion: 84 }))
      .mockResolvedValueOnce(createStatus({ installedVersion: 85 }));

    const { result } = renderHook(() => useHvscLibrary());

    act(() => {
      void result.current.handleHvscInstall();
    });

    await waitFor(() => expect(result.current.hvscUpdating).toBe(true));
    await waitFor(() => expect(result.current.hvscActionLabel).toBe("Applying updates…"));
    expect(mocks.installOrUpdateHvscMock).toHaveBeenCalledWith("hvsc-install");
    expect(result.current.hvscPhase).toBe("download");

    act(() => {
      resolveInstall?.();
    });
    await waitFor(() => expect(result.current.hvscUpdating).toBe(false));
  });

  it("recovers stale ingestion state on mount", async () => {
    renderHook(() => useHvscLibrary());

    await waitFor(() => expect(mocks.recoverStaleIngestionStateMock).toHaveBeenCalledTimes(1));
  });
});
