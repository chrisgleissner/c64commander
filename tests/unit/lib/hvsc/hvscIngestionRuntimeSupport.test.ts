import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addErrorLogMock = vi.fn();
const addLogMock = vi.fn();
const loadHvscStateMock = vi.fn();
const updateHvscStateMock = vi.fn();
const loadHvscStatusSummaryMock = vi.fn();
const saveHvscStatusSummaryMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
  addLog: (...args: unknown[]) => addLogMock(...args),
}));

vi.mock("@/lib/hvsc/hvscStateStore", () => ({
  loadHvscState: (...args: unknown[]) => loadHvscStateMock(...args),
  updateHvscState: (...args: unknown[]) => updateHvscStateMock(...args),
}));

vi.mock("@/lib/hvsc/hvscStatusStore", () => ({
  loadHvscStatusSummary: (...args: unknown[]) => loadHvscStatusSummaryMock(...args),
  saveHvscStatusSummary: (...args: unknown[]) => saveHvscStatusSummaryMock(...args),
}));

import {
  applyCancelledIngestionState,
  drainNativeProgressListeners,
  formatPathListPreview,
  getHvscIngestionRuntimeState,
  markIngestionRuntimeIdle,
  markInstalledLibraryConsistent,
  markInstalledLibraryTouched,
  recordStateBeforeIngestion,
  registerNativeProgressListener,
  removeNativeProgressListener,
  reportCacheStatFailure,
  resetCacheStatFailure,
  recoverStaleIngestionState,
} from "@/lib/hvsc/hvscIngestionRuntimeSupport";

describe("hvscIngestionRuntimeSupport", () => {
  beforeEach(() => {
    addErrorLogMock.mockReset();
    addLogMock.mockReset();
    loadHvscStateMock.mockReset();
    updateHvscStateMock.mockReset();
    loadHvscStatusSummaryMock.mockReset();
    saveHvscStatusSummaryMock.mockReset();

    const runtime = getHvscIngestionRuntimeState();
    runtime.cancelTokens.clear();
    runtime.nativeListenersByToken.clear();
    runtime.cacheStatFailures.clear();
    runtime.activeIngestionRunning = false;
  });

  it("removes listeners safely even when the token was never registered", async () => {
    const listener = {
      remove: vi.fn().mockRejectedValue(new Error("remove failed")),
    };

    await removeNativeProgressListener("missing", listener);

    expect(listener.remove).toHaveBeenCalledTimes(1);
    expect(getHvscIngestionRuntimeState().nativeListenersByToken.has("missing")).toBe(false);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to remove HVSC native progress listener",
      expect.objectContaining({ token: "missing", error: "remove failed" }),
    );
  });

  it("drains registered and empty listener sets", async () => {
    const first = { remove: vi.fn().mockResolvedValue(undefined) };
    const second = { remove: vi.fn().mockResolvedValue(undefined) };
    registerNativeProgressListener("token-a", first);
    registerNativeProgressListener("token-a", second);
    getHvscIngestionRuntimeState().nativeListenersByToken.set("token-empty", new Set());

    await drainNativeProgressListeners();

    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(second.remove).toHaveBeenCalledTimes(1);
    expect(getHvscIngestionRuntimeState().nativeListenersByToken.size).toBe(0);
  });

  it("tracks cache-stat failures, emits escalation warnings, and resets counts", () => {
    const emitProgress = vi.fn();
    const error = new Error("stat failed");

    reportCacheStatFailure("HVSC.7z", error, emitProgress);
    expect(addErrorLogMock).not.toHaveBeenCalled();

    reportCacheStatFailure("HVSC.7z", error, emitProgress);
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "HVSC cache health degraded",
      expect.objectContaining({ archiveName: "HVSC.7z", failureCount: 2 }),
    );
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "warning", archiveName: "HVSC.7z", errorCause: "stat failed" }),
    );

    resetCacheStatFailure("HVSC.7z");
    expect(getHvscIngestionRuntimeState().cacheStatFailures.has("HVSC.7z")).toBe(false);
  });

  it("formats path previews and applies cancellation state updates", () => {
    loadHvscStateMock.mockReturnValue({ installedVersion: 0 });
    getHvscIngestionRuntimeState().activeIngestionRunning = true;
    loadHvscStatusSummaryMock.mockReturnValue({
      download: { status: "in-progress", startedAt: "earlier" },
      extraction: { status: "idle" },
      lastUpdatedAt: null,
    });
    const emitProgress = vi.fn();

    expect(formatPathListPreview([])).toBe("none");
    expect(formatPathListPreview(Array.from({ length: 12 }, (_, index) => `file-${index}`))).toContain("(+2 more)");

    applyCancelledIngestionState(undefined, emitProgress, "HVSC.7z");
    markIngestionRuntimeIdle();

    expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "idle", ingestionError: "Canceled" });
    expect(saveHvscStatusSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        download: expect.objectContaining({
          status: "idle",
          errorMessage: "Canceled",
          archiveName: "HVSC.7z",
          lastStage: "cancelled",
          recoveryHint: expect.stringContaining("Retry the HVSC install or ingest"),
        }),
        extraction: expect.objectContaining({ status: "idle" }),
      }),
    );
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "cancelled", archiveName: "HVSC.7z", errorCause: "Canceled" }),
    );
  });

  describe("cancellation of an ingestion over an installed library", () => {
    const startIngestion = () => {
      getHvscIngestionRuntimeState().activeIngestionRunning = true;
      recordStateBeforeIngestion();
    };

    beforeEach(() => {
      markIngestionRuntimeIdle();
      loadHvscStateMock.mockReturnValue({ installedVersion: 85, ingestionState: "ready", ingestionError: null });
      loadHvscStatusSummaryMock.mockReturnValue({ download: { status: "idle" }, extraction: { status: "idle" } });
      startIngestion();
    });

    afterEach(() => {
      markIngestionRuntimeIdle();
    });

    it("returns the library to ready when the canceled run had not touched it", () => {
      applyCancelledIngestionState();

      expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "ready", ingestionError: null });
    });

    it("reports Canceled when the canceled run had touched the library", () => {
      markInstalledLibraryTouched();

      applyCancelledIngestionState();

      expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "idle", ingestionError: "Canceled" });
    });

    it("returns the library to ready when the touched archive had been applied completely", () => {
      markInstalledLibraryTouched();
      markInstalledLibraryConsistent();

      applyCancelledIngestionState();

      expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "ready", ingestionError: null });
    });

    it("forgets a touch from the previous ingestion once that ingestion has ended", () => {
      markInstalledLibraryTouched();
      markIngestionRuntimeIdle();
      startIngestion();

      applyCancelledIngestionState();

      expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "ready", ingestionError: null });
    });

    it("leaves the state unchanged when the cancel is applied after the ingestion has ended", () => {
      markInstalledLibraryTouched();
      markIngestionRuntimeIdle();

      applyCancelledIngestionState();

      expect(updateHvscStateMock).not.toHaveBeenCalled();
      expect(saveHvscStatusSummaryMock).not.toHaveBeenCalled();
    });

    it("keeps an earlier failure and its message when a retry is canceled before touching the library", () => {
      const failure = "HVSC ingestion cleanup failed for 3 file(s)";
      loadHvscStateMock.mockReturnValue({ installedVersion: 85, ingestionState: "error", ingestionError: failure });
      startIngestion();

      applyCancelledIngestionState();

      expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "error", ingestionError: failure });
    });

    it("reports Canceled when the run started from a state that was neither ready nor failed", () => {
      loadHvscStateMock.mockReturnValue({ installedVersion: 85, ingestionState: "updating", ingestionError: null });
      startIngestion();

      applyCancelledIngestionState();

      expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "idle", ingestionError: "Canceled" });
    });
  });

  it("recovers stale ingestion state only when a crashed install or update is detected", () => {
    loadHvscStateMock.mockReturnValueOnce({ ingestionState: "idle" });
    expect(recoverStaleIngestionState()).toBe(false);

    const runtime = getHvscIngestionRuntimeState();
    runtime.activeIngestionRunning = true;
    expect(recoverStaleIngestionState()).toBe(false);
    runtime.activeIngestionRunning = false;

    loadHvscStateMock.mockReturnValueOnce({ ingestionState: "installing" });
    loadHvscStatusSummaryMock.mockReturnValueOnce({
      download: { status: "in-progress" },
      extraction: { status: "in-progress" },
      lastUpdatedAt: null,
    });

    expect(recoverStaleIngestionState()).toBe(true);
    expect(updateHvscStateMock).toHaveBeenCalledWith({
      ingestionState: "error",
      ingestionError: "Interrupted by app restart",
    });
    expect(saveHvscStatusSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        download: expect.objectContaining({
          status: "failure",
          errorCategory: "unknown",
          lastStage: "recovered-interrupted",
          recoveryHint: expect.stringContaining("Partial progress was not promoted"),
        }),
        extraction: expect.objectContaining({
          status: "failure",
          errorCategory: "unknown",
          lastStage: "recovered-interrupted",
          recoveryHint: expect.stringContaining("Partial progress was not promoted"),
        }),
      }),
    );
  });
});
