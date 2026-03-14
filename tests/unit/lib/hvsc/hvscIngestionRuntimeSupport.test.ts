import { beforeEach, describe, expect, it, vi } from "vitest";

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
    loadHvscStatusSummaryMock.mockReturnValue({
      download: { status: "in-progress", startedAt: "earlier" },
      extraction: { status: "idle" },
      lastUpdatedAt: null,
    });
    const emitProgress = vi.fn();

    expect(formatPathListPreview([])).toBe("none");
    expect(formatPathListPreview(Array.from({ length: 12 }, (_, index) => `file-${index}`))).toContain("(+2 more)");

    applyCancelledIngestionState(undefined, emitProgress, "HVSC.7z");

    expect(updateHvscStateMock).toHaveBeenCalledWith({ ingestionState: "idle", ingestionError: "Cancelled" });
    expect(saveHvscStatusSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        download: expect.objectContaining({ status: "idle", errorMessage: "Cancelled" }),
        extraction: expect.objectContaining({ status: "idle" }),
      }),
    );
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "cancelled", archiveName: "HVSC.7z", errorCause: "Cancelled" }),
    );
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
        download: expect.objectContaining({ status: "failure", errorCategory: "unknown" }),
        extraction: expect.objectContaining({ status: "failure", errorCategory: "unknown" }),
      }),
    );
  });
});
