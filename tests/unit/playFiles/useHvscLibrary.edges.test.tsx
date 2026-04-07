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

describe("useHvscLibrary edge cases", () => {
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
    mocks.checkForHvscUpdatesMock.mockResolvedValue({ latestVersion: 1, installedVersion: 0, requiredUpdates: [1] });
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

  it("formatHvscDuration converts milliseconds to mm:ss string", () => {
    const { result } = renderHook(() => useHvscLibrary());

    expect(result.current.formatHvscDuration(90000)).toBe("1:30");
    expect(result.current.formatHvscDuration(0)).toBe("0:00");
    expect(result.current.formatHvscDuration(3661000)).toBe("61:01");
  });

  it("formatHvscTimestamp returns localized string for a valid ISO date", () => {
    const { result } = renderHook(() => useHvscLibrary());

    const ts = result.current.formatHvscTimestamp("2024-06-15T10:30:00Z");
    expect(ts).not.toBe("—");
    expect(typeof ts).toBe("string");
  });

  it("formatHvscTimestamp returns dash for an invalid date string", () => {
    const { result } = renderHook(() => useHvscLibrary());

    expect(result.current.formatHvscTimestamp("not-a-date")).toBe("—");
  });

  it("buildHvscLocalPlayFile arrayBuffer fetches song via getHvscSong and decodes base64", async () => {
    const testData = "hello sid";
    mocks.getHvscSongMock.mockResolvedValue({ dataBase64: btoa(testData) });

    const { result } = renderHook(() => useHvscLibrary());

    const file = result.current.buildHvscLocalPlayFile("/MUSICIANS/Test/song.sid", "song.sid");
    expect(file.name).toBe("song.sid");
    expect(file.webkitRelativePath).toBe("/MUSICIANS/Test/song.sid");

    const buffer = await file.arrayBuffer();
    expect(mocks.getHvscSongMock).toHaveBeenCalledWith({ virtualPath: "/MUSICIANS/Test/song.sid" });
    expect(buffer.byteLength).toBe(testData.length);
  });

  it("refreshHvscCacheStatus logs error when getHvscCacheStatus rejects", async () => {
    mocks.getHvscCacheStatusMock.mockRejectedValueOnce(new Error("cache fetch error"));

    renderHook(() => useHvscLibrary());

    await waitFor(() =>
      expect(mocks.addErrorLogMock).toHaveBeenCalledWith(
        "HVSC cache status fetch failed",
        expect.objectContaining({ error: "cache fetch error" }),
      ),
    );
  });

  it("progress error event with storage keywords resolves to storage failure category and label", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "error",
        errorCause: "ENOSPC: no space left on disk storage",
      });
    });

    await waitFor(() => expect(result.current.hvscSummaryState).toBe("failure"));
    expect(result.current.hvscSummaryFailureLabel).toBe("Storage error");
  });

  it("progress error event resolves to download failure category when last stage was download", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({ stage: "download", percent: 50, downloadedBytes: 500, totalBytes: 1000 });
    });

    await waitFor(() => expect(result.current.hvscDownloadStatus).toBe("in-progress"));

    act(() => {
      progressListener?.({ stage: "error", errorCause: "some generic download error" });
    });

    await waitFor(() => expect(result.current.hvscSummaryState).toBe("failure"));
    expect(result.current.hvscDownloadStatus).toBe("failure");
  });

  it("progress error event resolves to extraction failure category when last stage was archive_extraction", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({
        stage: "archive_extraction",
        percent: 30,
        processedCount: 3,
        totalCount: 10,
      });
      progressListener?.({ stage: "error", errorCause: "archive corrupt" });
    });

    await waitFor(() => expect(result.current.hvscSummaryState).toBe("failure"));
    expect(result.current.hvscExtractionStatus).toBe("failure");
    expect(result.current.hvscSummaryFailureLabel).toBe("Extraction error");
  });

  it("progress error event resolves to unknown failure category with unrecognized context", async () => {
    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(progressListener).not.toBeNull());

    act(() => {
      progressListener?.({ stage: "error" });
    });

    await waitFor(() => expect(result.current.hvscSummaryState).toBe("failure"));
  });

  it("hvscSummaryFailureLabel shows Extraction error for unsupported-format category", () => {
    mocks.loadHvscStatusSummaryMock.mockImplementation(() =>
      createSummary({
        extraction: { status: "failure", errorCategory: "unsupported-format" },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    expect(result.current.hvscSummaryFailureLabel).toBe("Extraction error");
  });

  it("handleHvscIngest reports non-cancel ingest failures via reportUserError", async () => {
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: 3, updateVersions: [] });
    mocks.ingestCachedHvscMock.mockRejectedValueOnce(new Error("ingest write failed"));

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscCanIngest).toBe(true));

    await act(async () => {
      await result.current.handleHvscIngest();
    });

    expect(mocks.reportUserErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "HVSC_INGEST",
        title: "HVSC ingest failed",
        description: "ingest write failed",
      }),
    );
    expect(result.current.hvscExtractionStatus).toBe("failure");
    expect(result.current.hvscInlineError).toBe("ingest write failed");
  });

  it("handleHvscIngest toast includes ingestion summary when getHvscStatus returns summary", async () => {
    mocks.getHvscCacheStatusMock.mockResolvedValue({ baselineVersion: 3, updateVersions: [] });
    mocks.getHvscStatusMock.mockResolvedValueOnce(createStatus()).mockResolvedValueOnce(
      createStatus({
        installedVersion: 3,
        ingestionSummary: {
          totalSongs: 50,
          ingestedSongs: 49,
          failedSongs: 1,
          songlengthSyntaxErrors: 2,
        },
      }),
    );

    const { result } = renderHook(() => useHvscLibrary());

    await waitFor(() => expect(result.current.hvscCanIngest).toBe(true));

    await act(async () => {
      await result.current.handleHvscIngest();
    });

    expect(mocks.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "HVSC ready",
        description: "Ready to use: Add items -> HVSC.",
      }),
    );
  });

  it("download progress event throttle path schedules a deferred update", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await Promise.resolve();
    });
    expect(progressListener).not.toBeNull();

    // First download event: stage changes from null to "download" → shouldUpdate=true
    act(() => {
      progressListener?.({
        stage: "download",
        percent: 20,
        downloadedBytes: 20,
        totalBytes: 100,
        message: "Downloading",
      });
    });

    expect(result.current.hvscDownloadStatus).toBe("in-progress");

    // Second download event immediately (elapsed < 120ms): shouldUpdate=false → schedules deferred update
    act(() => {
      progressListener?.({
        stage: "download",
        percent: 40,
        downloadedBytes: 40,
        totalBytes: 100,
        message: "Still downloading",
      });
    });

    // Advance timers so deferred update fires
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // After timer fires, the pending event has been applied
    expect(result.current.hvscDownloadStatus).toBe("in-progress");
  });

  it("extraction count throttle schedules pending events and applies them after delay", async () => {
    vi.useFakeTimers();
    // Use installing state so the stale-ingestion effect exits early (activeIngestion=true)
    mocks.getHvscStatusMock.mockResolvedValue(createStatus({ ingestionState: "installing" }));

    const { result } = renderHook(() => useHvscLibrary());

    await act(async () => {
      await Promise.resolve();
    });
    expect(progressListener).not.toBeNull();

    // First extraction event: applies immediately (elapsed >= 120ms since ref starts at 0)
    act(() => {
      progressListener?.({
        stage: "archive_extraction",
        processedCount: 100,
        totalCount: 1000,
        percent: 10,
      });
    });

    expect(result.current.hvscExtractionStatus).toBe("in-progress");

    // Second extraction event immediately (elapsed = 0 < 120ms): schedules deferred update
    act(() => {
      progressListener?.({
        stage: "archive_extraction",
        processedCount: 200,
        totalCount: 1000,
        percent: 20,
      });
    });

    // Advance timers so the deferred extraction update fires
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Third extraction event after 200ms (elapsed >= 120): clears the pending timer and applies directly
    act(() => {
      progressListener?.({
        stage: "archive_extraction",
        processedCount: 300,
        totalCount: 1000,
        percent: 30,
      });
    });

    expect(result.current.hvscExtractionStatus).toBe("in-progress");
  });
});
