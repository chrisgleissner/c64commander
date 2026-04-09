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
  runWithActionTraceMock: vi.fn(async (_context: unknown, fn: () => Promise<unknown>) => await fn()),
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
  resetHvscLibraryDataMock: vi.fn(),
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

vi.mock("@/lib/hvsc", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hvsc")>("@/lib/hvsc");
  return {
    ...actual,
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
    resetHvscLibraryData: (...args: unknown[]) => mocks.resetHvscLibraryDataMock(...args),
    recoverStaleIngestionState: (...args: unknown[]) => mocks.recoverStaleIngestionStateMock(...args),
  };
});

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
  lastUpdatedAt: overrides.lastUpdatedAt !== undefined ? overrides.lastUpdatedAt : null,
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

describe("useHvscLibrary preparation state coverage", () => {
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
    mocks.checkForHvscUpdatesMock.mockResolvedValue({
      latestVersion: 85,
      installedVersion: 0,
      requiredUpdates: [85],
    });
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
    mocks.resetHvscLibraryDataMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports DOWNLOADING state and derives preparation progress percent from download percent", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: {
          status: "in-progress",
          downloadedBytes: 500,
          totalBytes: 1000,
          startedAt: null,
          durationMs: null,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADING"));
    expect(result.current.hvscPreparationProgressPercent).toBe(50);
  });

  it("returns null preparation progress percent when state is NOT_PRESENT", async () => {
    mocks.isHvscBridgeAvailableMock.mockReturnValue(false);

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("NOT_PRESENT"));
    expect(result.current.hvscPreparationProgressPercent).toBeNull();
  });

  it("computes MB/s throughput label when DOWNLOADING with bytes and elapsed time", async () => {
    // 5 MB downloaded in 2 seconds = 2.5 MB/s
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: {
          status: "in-progress",
          downloadedBytes: 5 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          startedAt: null,
          durationMs: 2000,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADING"));
    expect(result.current.hvscPreparationThroughputLabel).toMatch(/MB\/s/);
  });

  it("formats throughput as integer MB/s when speed is >= 10 MB/s", async () => {
    // 20 MB downloaded in 1 second = 20 MB/s → formatted as "20 MB/s"
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: {
          status: "in-progress",
          downloadedBytes: 20 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          startedAt: null,
          durationMs: 1000,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADING"));
    expect(result.current.hvscPreparationThroughputLabel).toBe("20 MB/s");
  });

  it("returns null throughput label when DOWNLOADING but no bytes or elapsed data", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: {
          status: "in-progress",
          downloadedBytes: null,
          totalBytes: null,
          startedAt: null,
          durationMs: null,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADING"));
    expect(result.current.hvscPreparationThroughputLabel).toBeNull();
  });

  it("reports INGESTING state and derives preparation progress from metadata percent when metadata is in-progress", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        metadata: {
          status: "in-progress",
          percent: 75,
          processedSongs: null,
          durationMs: null,
        },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
    expect(result.current.hvscPreparationProgressPercent).toBe(75);
  });

  it("derives preparation progress from extraction percent when INGESTING and metadata not in-progress", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        extraction: {
          status: "in-progress",
          filesExtracted: 40,
          totalFiles: 200,
          startedAt: null,
          durationMs: null,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
    expect(result.current.hvscPreparationProgressPercent).toBe(20);
  });

  it("computes items/s throughput label when INGESTING with metadata in-progress and processedSongs", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        metadata: {
          status: "in-progress",
          processedSongs: 4000,
          durationMs: 2000,
          percent: 40,
        },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
    const label = result.current.hvscPreparationThroughputLabel;
    expect(label).not.toBeNull();
    expect(label).toMatch(/items\/s/);
  });

  it("computes items/s throughput label when INGESTING with extraction filesExtracted and elapsed time", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        extraction: {
          status: "in-progress",
          filesExtracted: 3000,
          totalFiles: 10000,
          startedAt: null,
          durationMs: 3000,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
    const label = result.current.hvscPreparationThroughputLabel;
    expect(label).not.toBeNull();
    expect(label).toMatch(/items\/s/);
  });

  it("returns null throughput label when INGESTING but no processedSongs or elapsed data", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        metadata: {
          status: "in-progress",
          processedSongs: null,
          durationMs: null,
          percent: 20,
        },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
    expect(result.current.hvscPreparationThroughputLabel).toBeNull();
  });

  it("runHvscPreparation is a no-op when state is READY", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 85, ingestionState: "ready" }));

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("READY"));

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
    expect(mocks.ingestCachedHvscMock).not.toHaveBeenCalled();
  });

  it("runHvscPreparation calls handleHvscIngest when state is DOWNLOADED", async () => {
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: 85, updateVersions: [] });

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADED"));

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.ingestCachedHvscMock).toHaveBeenCalledTimes(1);
    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
  });

  it("runHvscPreparation calls handleHvscIngest when state is ERROR with failedPhase=ingest", async () => {
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: 85, updateVersions: [] });
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        extraction: {
          status: "failure",
          errorMessage: "extraction failed",
          errorCategory: "extraction",
        },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => {
      expect(result.current.hvscPreparationState).toBe("ERROR");
      expect(result.current.hvscPreparationFailedPhase).toBe("ingest");
      expect(result.current.hvscCanIngest).toBe(true);
    });

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.ingestCachedHvscMock).toHaveBeenCalledTimes(1);
    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
  });

  it("runHvscPreparation calls handleHvscInstall when state is NOT_PRESENT", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("NOT_PRESENT"));

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.installOrUpdateHvscMock).toHaveBeenCalledTimes(1);
  });

  it("runHvscPreparation is a no-op when hvsc bridge is not available", async () => {
    mocks.isHvscBridgeAvailableMock.mockReturnValue(false);

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("NOT_PRESENT"));

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
    expect(mocks.ingestCachedHvscMock).not.toHaveBeenCalled();
  });

  it("reports DOWNLOADING state when download status is in-progress via initial summary", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: {
          status: "in-progress",
          downloadedBytes: null,
          totalBytes: null,
          durationMs: null,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADING"));
    expect(result.current.hvscDownloadStatus).toBe("in-progress");
  });

  it("reports INGESTING state when extraction status is in-progress via initial summary", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        extraction: {
          status: "in-progress",
          filesExtracted: null,
          totalFiles: null,
          durationMs: null,
        },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
    expect(result.current.hvscExtractionStatus).toBe("in-progress");
  });

  it("logs preparation state transition on state change", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 85, ingestionState: "ready" }));

    renderHook(() => useHvscLibrary());

    await waitFor(() =>
      expect(mocks.addLogMock).toHaveBeenCalledWith(
        "info",
        "HVSC preparation state transition",
        expect.objectContaining({ toState: "READY" }),
      ),
    );
  });

  it("returns hvscPhase as index when metadata is in-progress and hvsc is not updating", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        metadata: { status: "in-progress", percent: 30 },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscPhase).toBe("index"));
  });

  it("returns hvscPhase as index when metadata in-progress via progress event when hvscUpdating", async () => {
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

    await waitFor(() => expect(result.current.hvscUpdating).toBe(true));

    act(() => {
      progressListener?.({
        stage: "sid_metadata_parsing",
        percent: 50,
        processedCount: 5,
        totalCount: 10,
        elapsedTimeMs: 1000,
        message: "Building index",
      });
    });

    await waitFor(() => expect(result.current.hvscPhase).toBe("index"));

    act(() => {
      resolveInstall?.();
    });
  });

  it("derives download progress percent from progress event when download status in-progress via event", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "download",
        percent: 42,
        downloadedBytes: 420,
        totalBytes: 1000,
        elapsedTimeMs: 800,
        message: "Downloading HVSC",
      });
    });

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("DOWNLOADING"));
    expect(result.current.hvscPreparationProgressPercent).toBe(42);
  });

  it("derives INGESTING progress from metadata percent when progress event sets metadata in-progress summary", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "sid_metadata_hydration",
        percent: 60,
        processedCount: 60,
        totalCount: 100,
        elapsedTimeMs: 1500,
        message: "Indexing metadata",
      });
    });

    await waitFor(() => expect(result.current.hvscPreparationState).toBe("INGESTING"));
  });
});
