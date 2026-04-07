import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  resetHvscLibraryDataMock: vi.fn(),
  recoverStaleIngestionStateMock: vi.fn(),
  recordSmokeBenchmarkSnapshotMock: vi.fn(),
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

vi.mock("@/lib/smoke/smokeMode", () => ({
  recordSmokeBenchmarkSnapshot: (...args: unknown[]) => mocks.recordSmokeBenchmarkSnapshotMock(...args),
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

describe("useHvscLibrary", () => {
  let progressListener: ((event: Record<string, unknown>) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    progressListener = null;
    mocks.addHvscProgressListenerMock.mockImplementation((listener: (event: Record<string, unknown>) => void) => {
      progressListener = listener;
      return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) });
    });
    mocks.cancelHvscInstallMock.mockResolvedValue(undefined);
    mocks.checkForHvscUpdatesMock.mockResolvedValue({ latestVersion: 1, installedVersion: 0, requiredUpdates: [1] });
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
    mocks.recordSmokeBenchmarkSnapshotMock.mockReset();
  });

  it("removes a pending progress listener after unmount when registration resolves late", async () => {
    let resolveListener: ((value: { remove: () => Promise<void> }) => void) | null = null;
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.addHvscProgressListenerMock.mockImplementation(
      () =>
        new Promise<{ remove: () => Promise<void> }>((resolve) => {
          resolveListener = resolve;
        }),
    );

    const { unmount } = renderHook(() => useHvscLibrary());

    unmount();
    resolveListener?.({ remove });
    await Promise.resolve();
    await Promise.resolve();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("stays idle and skips bridge work when the HVSC bridge is unavailable", async () => {
    mocks.isHvscBridgeAvailableMock.mockReturnValue(false);

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscAvailable).toBe(false));
    expect(result.current.hvscLibraryAvailable).toBe(false);
    expect(result.current.hvscCanIngest).toBe(false);
    expect(result.current.hvscPhase).toBe("idle");
    expect(mocks.getHvscStatusMock).not.toHaveBeenCalled();
    expect(mocks.getHvscCacheStatusMock).not.toHaveBeenCalled();
  });

  it("marks stale in-progress summaries as interrupted when ingestion is no longer active", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: { status: "in-progress" },
        extraction: { status: "in-progress" },
        lastUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ ingestionState: "idle" }));

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(mocks.saveHvscStatusSummaryMock).toHaveBeenCalled());
    expect(mocks.addLogMock).toHaveBeenCalledWith(
      "warn",
      "HVSC progress interrupted",
      expect.objectContaining({ ingestionState: "idle" }),
    );
    expect(result.current.hvscSummaryState).toBe("failure");
  });

  it("logs listener registration failures without crashing the hook", async () => {
    mocks.addHvscProgressListenerMock.mockRejectedValueOnce(new Error("register failed"));

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() =>
      expect(mocks.addErrorLogMock).toHaveBeenCalledWith(
        "HVSC progress listener registration failed",
        expect.objectContaining({ error: "register failed" }),
      ),
    );
    expect(result.current.hvscPhase).toBe("idle");
  });

  it("auto-loads the selected folder once HVSC is installed", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 42 }));
    mocks.getHvscFolderListingMock.mockResolvedValue({
      path: "/MUSICIANS",
      folders: ["/MUSICIANS/A", "/MUSICIANS/B"],
      songs: [{ id: 1, virtualPath: "/MUSICIANS/A/demo.sid", fileName: "demo.sid" }],
    });

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(mocks.getHvscFolderListingMock).toHaveBeenCalledWith("/"));
    await waitFor(() => expect(result.current.selectedHvscFolder).toBe("/MUSICIANS"));
    expect(result.current.hvscFolders).toEqual(["/MUSICIANS/A", "/MUSICIANS/B"]);
    expect(result.current.hvscSongs).toHaveLength(1);
    expect(result.current.hvscLibraryAvailable).toBe(true);
    expect(result.current.hvscInstalled).toBe(true);
  });

  it("reports folder loading failures", async () => {
    mocks.getHvscFolderListingMock.mockRejectedValueOnce(new Error("browse failed"));
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.loadHvscFolder("/broken");
    });

    expect(mocks.reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HVSC_BROWSE",
        title: "HVSC browse failed",
        description: "browse failed",
      }),
    );
  });

  it("completes the install flow immediately when HVSC is already up to date", async () => {
    mocks.checkForHvscUpdatesMock.mockResolvedValue({ latestVersion: 5, installedVersion: 5, requiredUpdates: [] });
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 5 }));

    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscInstall();
    });

    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
    expect(mocks.toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "HVSC up to date" }));
    expect(mocks.recordSmokeBenchmarkSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: "install", state: "up-to-date" }),
    );
    expect(result.current.hvscSummaryState).toBe("success");
    expect(result.current.hvscPhase).toBe("ready");
  });

  it("installs HVSC updates and reports the ingestion summary", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(
      createStatus({
        installedVersion: 6,
        ingestionSummary: {
          totalSongs: 100,
          ingestedSongs: 98,
          failedSongs: 2,
          songlengthSyntaxErrors: 3,
        },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscInstall();
    });

    expect(mocks.installOrUpdateHvscMock).toHaveBeenCalledWith("hvsc-install");
    expect(mocks.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "HVSC ready",
        description: "Ready to use: Add items -> HVSC.",
      }),
    );
    expect(mocks.recordSmokeBenchmarkSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: "install", state: "complete" }),
    );
    expect(result.current.hvscIngestionTotalSongs).toBe(100);
    expect(result.current.hvscIngestionFailedSongs).toBe(2);
  });

  it("reports install failures and exposes the inline error", async () => {
    mocks.installOrUpdateHvscMock.mockRejectedValueOnce(new Error("download failed"));
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscInstall();
    });

    expect(mocks.reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HVSC_DOWNLOAD",
        title: "HVSC update failed",
        description: "download failed",
      }),
    );
    expect(result.current.hvscInlineError).toBe("download failed");
    expect(result.current.hvscSummaryState).toBe("failure");
  });

  it("swallows cancelled install failures without surfacing a user error", async () => {
    mocks.installOrUpdateHvscMock.mockRejectedValueOnce(new Error("cancelled by user"));
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscInstall();
    });

    expect(mocks.reportUserErrorMock).not.toHaveBeenCalled();
    expect(result.current.hvscSummaryState).toBe("failure");
    expect(result.current.hvscInlineError).toBeNull();
  });

  it("refuses ingest when there is no cached HVSC data", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscIngest();
    });

    expect(mocks.toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "HVSC cache missing" }));
    expect(mocks.ingestCachedHvscMock).not.toHaveBeenCalled();
  });

  it("ingests cached HVSC data when a cache baseline exists", async () => {
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: 3, updateVersions: [] });
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 3 }));

    const { result } = renderHook(() => useHvscLibrary());
    await waitFor(() => expect(result.current.hvscCanIngest).toBe(true));

    await act(async () => {
      await result.current.handleHvscIngest();
    });

    expect(mocks.ingestCachedHvscMock).toHaveBeenCalledWith("hvsc-ingest");
    expect(mocks.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "HVSC ready", description: "Ready to use: Add items -> HVSC." }),
    );
    expect(mocks.recordSmokeBenchmarkSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: "ingest", state: "complete" }),
    );
  });

  it("starts the full install flow when HVSC is first requested without cached data", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.installOrUpdateHvscMock).toHaveBeenCalledWith("hvsc-install");
    expect(mocks.ingestCachedHvscMock).not.toHaveBeenCalled();
  });

  it("retries indexing from the cached archive after an ingest failure", async () => {
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: 3, updateVersions: [] });
    mocks.getHvscStatusMock.mockResolvedValue(
      createStatus({
        installedVersion: 0,
        ingestionState: "error",
        ingestionError: "metadata failed",
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());
    await waitFor(() => expect(result.current.hvscPreparationState).toBe("ERROR"));

    await act(async () => {
      await result.current.retryHvscPreparation();
    });

    expect(mocks.ingestCachedHvscMock).toHaveBeenCalledWith("hvsc-ingest");
    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
  });

  it("does not restart preparation after the library is already ready", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(
      createStatus({
        installedVersion: 7,
        ingestionState: "ready",
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());
    await waitFor(() => expect(result.current.hvscPreparationState).toBe("READY"));

    await act(async () => {
      await result.current.runHvscPreparation();
    });

    expect(mocks.installOrUpdateHvscMock).not.toHaveBeenCalled();
    expect(mocks.ingestCachedHvscMock).not.toHaveBeenCalled();
  });

  it("cancels in-progress work and tolerates status refresh failures afterwards", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: { status: "in-progress" },
        extraction: { status: "in-progress" },
      }),
    );
    mocks.getHvscStatusMock.mockRejectedValueOnce(new Error("status refresh failed"));

    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscCancel();
    });

    expect(mocks.cancelHvscInstallMock).toHaveBeenCalledWith("hvsc-install");
    expect(mocks.addErrorLogMock).toHaveBeenCalledWith(
      "HVSC status fetch failed",
      expect.objectContaining({ error: "status refresh failed" }),
    );
    expect(mocks.toastMock).toHaveBeenCalledWith({ title: "HVSC update cancelled" });
    expect(result.current.hvscInlineError).toBe("Cancelled");
    expect(result.current.hvscDownloadStatus).toBe("idle");
    expect(result.current.hvscExtractionStatus).toBe("idle");
  });

  it("reports cancel failures", async () => {
    mocks.cancelHvscInstallMock.mockRejectedValueOnce(new Error("cancel failed"));
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscCancel();
    });

    expect(mocks.reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HVSC_CANCEL",
        title: "Cancel failed",
        description: "cancel failed",
      }),
    );
  });

  it("resets the cached library data and clears transient progress state", async () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        download: { status: "failure", errorMessage: "old error" },
        extraction: { status: "success", filesExtracted: 10 },
        lastUpdatedAt: new Date().toISOString(),
      }),
    );
    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await result.current.handleHvscReset();
    });

    expect(mocks.resetHvscLibraryDataMock).toHaveBeenCalledTimes(1);
    expect(mocks.clearHvscStatusSummaryMock).toHaveBeenCalledTimes(1);
    expect(result.current.hvscDownloadStatus).toBe("idle");
    expect(result.current.hvscExtractionStatus).toBe("idle");
    expect(result.current.hvscInlineError).toBeNull();
    expect(result.current.selectedHvscFolder).toBe("/");
    expect(result.current.hvscSongs).toEqual([]);
    expect(mocks.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "HVSC reset",
        description: "The cached HVSC archives and indexed library were removed.",
      }),
    );
  });

  it("derives download, extraction, and failure state from progress events", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "download",
        percent: 25,
        downloadedBytes: 50,
        totalBytes: 200,
        elapsedTimeMs: 500,
        message: "Downloading HVSC",
      });
    });

    await waitFor(() => expect(result.current.hvscDownloadStatus).toBe("in-progress"));
    expect(result.current.hvscDownloadPercent).toBe(25);
    expect(result.current.hvscActionLabel).toBe("Downloading HVSC");

    act(() => {
      progressListener?.({
        stage: "songlengths",
        percent: 50,
        processedCount: 4,
        totalCount: 8,
        elapsedTimeMs: 1500,
        message: "Loading songlengths",
        archiveName: "Songlengths.txt",
      });
    });

    await waitFor(() => expect(result.current.hvscPhase).toBe("index"));
    expect(result.current.hvscSummaryFilesExtracted).toBe(4);
    expect(result.current.hvscExtractionPercent).toBe(50);
    expect(mocks.addLogMock).toHaveBeenCalledWith(
      "info",
      "HVSC songlengths source loaded",
      expect.objectContaining({ archiveName: "Songlengths.txt" }),
    );

    act(() => {
      progressListener?.({
        stage: "error",
        errorType: "network-timeout",
        errorCause: "socket timeout",
      });
    });

    await waitFor(() => expect(result.current.hvscSummaryState).toBe("failure"));
    expect(result.current.hvscSummaryFailureLabel).toBe("Network error");
    expect(result.current.hvscPhase).toBe("failed");

    act(() => {
      progressListener?.({ stage: "complete" });
    });

    await waitFor(() => expect(result.current.hvscDownloadStatus).toBe("success"));
    expect(result.current.hvscExtractionStatus).toBe("success");
  });

  it("filters visible folders case-insensitively", async () => {
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ installedVersion: 9 }));
    mocks.getHvscFolderListingMock.mockResolvedValue({
      path: "/",
      folders: ["/DEMOS", "/Games", "/MUSICIANS"],
      songs: [],
    });

    const { result } = renderHook(() => useHvscLibrary());
    await waitFor(() => expect(result.current.hvscFolders).toHaveLength(3));

    act(() => {
      result.current.setHvscFolderFilter("ga");
    });

    expect(result.current.hvscVisibleFolders).toEqual(["/Games"]);
  });
});
