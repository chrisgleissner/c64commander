/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLocalStorageKey } from "@/generated/variant";
import {
  applyHvscProgressEventToSummary,
  clearHvscStatusSummary,
  getDefaultHvscStatusSummary,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
  updateHvscStatusSummaryFromEvent,
  recordHvscQueryTiming,
  type HvscStatusSummary,
} from "@/lib/hvsc/hvscStatusStore";
import { addLog } from "@/lib/logging";

const STORAGE_KEY = buildLocalStorageKey("hvsc_status:v1");

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

describe("hvscStatusStore", () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage === "undefined") {
      const store = new Map<string, string>();
      (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      } as Storage;
    } else {
      globalThis.localStorage.clear();
    }
  });

  describe("Persistence", () => {
    it("returns defaults when storage is empty", () => {
      expect(loadHvscStatusSummary()).toEqual(getDefaultHvscStatusSummary());
    });

    it("persists and loads summary data", () => {
      const summary: HvscStatusSummary = {
        download: {
          status: "success",
          ingestionId: "ingestion-1",
          archiveName: "hvsc-baseline-84.7z",
          lastStage: "download",
          startedAt: "now",
          finishedAt: "later",
          durationMs: 1234,
          sizeBytes: 987,
          downloadedBytes: 456,
          totalBytes: 1024,
          recoveryHint: null,
        },
        extraction: {
          status: "success",
          ingestionId: "ingestion-1",
          archiveName: "hvsc-baseline-84.7z",
          lastStage: "complete",
          startedAt: "now",
          finishedAt: "later",
          durationMs: 5678,
          filesExtracted: 42,
          totalFiles: 120,
          recoveryHint: null,
        },
        metadata: {
          status: "success",
          stateToken: "done",
          processedSongs: 120,
          totalSongs: 120,
          percent: 100,
          recoveryHint: null as never,
        },
        lastUpdatedAt: "later",
      };

      saveHvscStatusSummary(summary);
      expect(loadHvscStatusSummary()).toEqual(summary);

      clearHvscStatusSummary();
      expect(loadHvscStatusSummary()).toEqual(getDefaultHvscStatusSummary());
    });

    it("merges default metadata fields when older persisted summaries omit them", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          download: { status: "success" },
          extraction: { status: "idle" },
        }),
      );

      expect(loadHvscStatusSummary()).toEqual({
        ...getDefaultHvscStatusSummary(),
        download: { status: "success" },
        extraction: { status: "idle" },
        metadata: { status: "idle", stateToken: null },
      });
    });

    it("persists status updates from events", () => {
      const result = updateHvscStatusSummaryFromEvent({
        ingestionId: "test",
        stage: "download",
        message: "Downloading",
        downloadedBytes: 10,
        totalBytes: 20,
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      expect(stored.download?.downloadedBytes).toBe(10);
      expect(result.download.downloadedBytes).toBe(10);
      expect(result.download.ingestionId).toBe("test");
    });

    it("ignores updates when storage is corrupted", () => {
      localStorage.setItem(STORAGE_KEY, "invalid-json{");
      const loaded = loadHvscStatusSummary();
      expect(loaded).toEqual(getDefaultHvscStatusSummary());
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        "Failed to load HVSC status summary",
        expect.objectContaining({
          storageKey: STORAGE_KEY,
          error: expect.any(String),
        }),
      );
    });

    it("ignores updates when summary misses core properties", () => {
      localStorage.setItem(STORAGE_KEY, "{}");
      const loaded = loadHvscStatusSummary();
      expect(loaded).toEqual(getDefaultHvscStatusSummary());
    });

    it("handles missing localStorage safely", () => {
      const originalLocalStorage = globalThis.localStorage;
      Reflect.deleteProperty(globalThis, "localStorage");

      expect(loadHvscStatusSummary()).toEqual(getDefaultHvscStatusSummary());
      expect(() => saveHvscStatusSummary(getDefaultHvscStatusSummary())).not.toThrow();
      expect(() => clearHvscStatusSummary()).not.toThrow();

      globalThis.localStorage = originalLocalStorage;
    });
  });

  describe("State transitions", () => {
    it("tracks incremental download progress", () => {
      const initial = getDefaultHvscStatusSummary();
      const summary = applyHvscProgressEventToSummary(initial, {
        ingestionId: "test",
        stage: "download",
        message: "Downloading",
        downloadedBytes: 512,
        totalBytes: 2048,
        percent: 25,
      });
      expect(summary.download.status).toBe("in-progress");
      expect(summary.download.ingestionId).toBe("test");
      expect(summary.download.downloadedBytes).toBe(512);
      expect(summary.download.totalBytes).toBe(2048);
    });

    it("marks marks download success when extraction starts", () => {
      const base = getDefaultHvscStatusSummary();
      const downloadEvent = {
        stage: "download",
        message: "Downloading",
        downloadedBytes: 10,
        totalBytes: 100,
      } as any;
      const extractionEvent = {
        stage: "archive_extraction",
        message: "Extracting",
        processedCount: 1,
        totalCount: 2,
      } as any;

      const afterDownload = applyHvscProgressEventToSummary(base, downloadEvent, null);
      expect(afterDownload.download.status).toBe("in-progress");

      const afterExtraction = applyHvscProgressEventToSummary(afterDownload, extractionEvent, "download");
      expect(afterExtraction.download.status).toBe("success");
      expect(afterExtraction.extraction.status).toBe("in-progress");
    });

    it("marks download success when percent reaches 100", () => {
      const base = getDefaultHvscStatusSummary();
      const event = {
        stage: "download",
        message: "Downloaded",
        archiveName: "hvsc-baseline-84.7z",
        downloadedBytes: 100,
        totalBytes: 100,
        percent: 100,
        elapsedTimeMs: 1234,
      } as any;

      const next = applyHvscProgressEventToSummary(base, event, null);
      expect(next.download.status).toBe("success");
      expect(next.download.archiveName).toBe("hvsc-baseline-84.7z");
      expect(next.download.finishedAt).toBeTruthy();
      expect(next.download.durationMs).toBe(1234);
      expect(next.download.totalBytes).toBe(100);
    });

    it("records recovery hints on extraction failures", () => {
      const initial = getDefaultHvscStatusSummary();
      const next = applyHvscProgressEventToSummary(
        initial,
        {
          ingestionId: "ingestion-2",
          stage: "error",
          message: "corrupt archive",
          archiveName: "hvsc-update-85.7z",
          errorCause: "corrupt archive",
        },
        "archive_validation",
      );

      expect(next.extraction.status).toBe("failure");
      expect(next.extraction.archiveName).toBe("hvsc-update-85.7z");
      expect(next.extraction.recoveryHint).toContain("Delete the cached archive");
    });

    it("tracks metadata hydration progress with concise state tokens", () => {
      const initial = getDefaultHvscStatusSummary();

      const running = applyHvscProgressEventToSummary(initial, {
        ingestionId: "meta-1",
        stage: "sid_metadata_hydration",
        statusToken: "running",
        message: "HVSC META 12/60 running",
        processedCount: 12,
        totalCount: 60,
        percent: 20,
      });

      expect(running.metadata.status).toBe("in-progress");
      expect(running.metadata.stateToken).toBe("running");
      expect(running.metadata.processedSongs).toBe(12);
      expect(running.metadata.totalSongs).toBe(60);

      const done = applyHvscProgressEventToSummary(running, {
        ingestionId: "meta-1",
        stage: "sid_metadata_hydration",
        statusToken: "done",
        message: "HVSC META 60/60 done",
        processedCount: 60,
        totalCount: 60,
        percent: 100,
      });

      expect(done.metadata.status).toBe("success");
      expect(done.metadata.stateToken).toBe("done");
      expect(done.metadata.finishedAt).toBeTruthy();
    });

    it("infers metadata completion state and percent when the event omits them", () => {
      const initial = getDefaultHvscStatusSummary();

      const done = applyHvscProgressEventToSummary(initial, {
        ingestionId: "meta-implicit",
        stage: "sid_metadata_hydration",
        message: "HVSC META 60/60 done",
        processedCount: 60,
        totalCount: 60,
      });

      expect(done.metadata.status).toBe("success");
      expect(done.metadata.stateToken).toBe("done");
      expect(done.metadata.percent).toBe(100);
      expect(done.metadata.finishedAt).toBeTruthy();
    });

    it("infers running metadata state and percent for partial progress events", () => {
      const initial = getDefaultHvscStatusSummary();

      const running = applyHvscProgressEventToSummary(initial, {
        ingestionId: "meta-implicit-running",
        stage: "sid_metadata_hydration",
        message: "HVSC META 12/60 running",
        processedCount: 12,
        totalCount: 60,
      });

      expect(running.metadata.status).toBe("in-progress");
      expect(running.metadata.stateToken).toBe("running");
      expect(running.metadata.percent).toBe(20);
      expect(running.metadata.finishedAt).toBeNull();
    });

    it("treats metadata progress events with an explicit error token as failures", () => {
      const initial = getDefaultHvscStatusSummary();

      const failed = applyHvscProgressEventToSummary(initial, {
        ingestionId: "meta-token-error",
        stage: "sid_metadata_hydration",
        statusToken: "error",
        message: "HVSC META failed",
        errorCause: "parse failed",
        processedCount: 12,
        totalCount: 60,
        failedSongs: 3,
      });

      expect(failed.metadata.status).toBe("failure");
      expect(failed.metadata.stateToken).toBe("error");
      expect(failed.metadata.errorMessage).toBe("parse failed");
      expect(failed.metadata.errorCount).toBe(3);
      expect(failed.metadata.finishedAt).toBeTruthy();
    });

    it("records metadata hydration failures and falls back to the event message", () => {
      const initial = getDefaultHvscStatusSummary();

      const failed = applyHvscProgressEventToSummary(
        initial,
        {
          ingestionId: "meta-2",
          stage: "error",
          message: "HVSC META failed",
          processedCount: 12,
          totalCount: 60,
          failedSongs: 2,
        },
        "sid_metadata_hydration",
      );

      expect(failed.metadata.status).toBe("failure");
      expect(failed.metadata.stateToken).toBe("error");
      expect(failed.metadata.errorMessage).toBe("HVSC META failed");
      expect(failed.metadata.errorCount).toBe(2);
      expect(failed.metadata.finishedAt).toBeTruthy();
    });

    it("ignores non-complete events", () => {
      const initial = getDefaultHvscStatusSummary();
      // @ts-expect-error - simulating unknown stage
      const result = applyHvscProgressEventToSummary(initial, {
        stage: "unknown_stage",
        message: "test",
      });
      expect(result).toEqual(initial);
    });

    it("handles download success with existing finishedAt", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.finishedAt = "existing-time";

      const next = applyHvscProgressEventToSummary(initial, {
        stage: "download",
        message: "done",
        percent: 100,
      });

      expect(next.download.finishedAt).toBe("existing-time");
    });

    it("preserves existing duration when event does not provide it", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.durationMs = 999;

      const next = applyHvscProgressEventToSummary(initial, {
        stage: "download",
        message: "progress",
        percent: 50,
      });

      expect(next.download.durationMs).toBe(999);
    });

    it("updates download size and total bytes properly", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.downloadedBytes = 50;
      initial.download.sizeBytes = 50;

      // Case 1: event has totalBytes -> uses event.totalBytes
      let next = applyHvscProgressEventToSummary(initial, {
        stage: "download",
        message: "progress",
        downloadedBytes: 60,
        totalBytes: 100,
      });
      expect(next.download.sizeBytes).toBe(100);

      // Case 2: download complete, no totalBytes -> uses downloadedBytes
      // Reset for clarity
      initial.download.downloadedBytes = 50;
      initial.download.sizeBytes = 50;
      next = applyHvscProgressEventToSummary(initial, {
        stage: "download",
        message: "done",
        percent: 100,
        downloadedBytes: 120, // no totalBytes property
      });
      expect(next.download.sizeBytes).toBe(120);

      // Case 3: in-progress, no totalBytes -> keeps old sizeBytes
      initial.download.sizeBytes = 999;
      next = applyHvscProgressEventToSummary(initial, {
        stage: "download",
        message: "progress",
        downloadedBytes: 60,
        // no totalBytes, no completion
      });
      expect(next.download.sizeBytes).toBe(999);
    });

    it("marks download success when extraction starts (with status transition)", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.status = "in-progress";

      const result = applyHvscProgressEventToSummary(initial, {
        stage: "archive_extraction",
        message: "extracting",
      });

      expect(result.download.status).toBe("success");
    });

    it("keeps download status if not in-progress when extraction starts", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.status = "idle";

      const result = applyHvscProgressEventToSummary(initial, {
        stage: "archive_extraction",
        message: "extracting",
      });

      expect(result.download.status).toBe("idle");
    });

    it("preserves success status on completion event", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.extraction.status = "success";
      initial.download.status = "success";

      const result = applyHvscProgressEventToSummary(initial, {
        stage: "complete",
        message: "done",
      });

      expect(result.extraction.status).toBe("success");
      expect(result.download.status).toBe("success");
    });

    it("handles generic errors not matching categories", () => {
      const initial = getDefaultHvscStatusSummary();
      const result = applyHvscProgressEventToSummary(
        initial,
        {
          stage: "error",
          message: "Something weird happened",
        },
        "download",
      );

      expect(result.download.errorCategory).toBe("download");
    });

    it("handles extraction failure when error stage is unknown", () => {
      const initial = getDefaultHvscStatusSummary();
      const result = applyHvscProgressEventToSummary(
        initial,
        {
          stage: "error",
          message: "Something weird happened",
        },
        "unknown_stage_name",
      );

      // Default fallthrough logic for unknown lastStage?
      // The code: if (lastStage === 'download') { ... } return { extraction: ... }
      // So unexpected lastStage falls through to extraction error
      expect(result.extraction.status).toBe("failure");
    });
  });

  describe("Failure handling", () => {
    it("classifies download failures and stores error details", () => {
      const initial = getDefaultHvscStatusSummary();
      const summary = applyHvscProgressEventToSummary(
        initial,
        {
          ingestionId: "test",
          stage: "error",
          message: "Request failed",
          errorCause: "Connection refused",
        },
        "download",
      );

      expect(summary.download.status).toBe("failure");
      expect(summary.download.errorCategory).toBe("network");
      expect(summary.download.errorMessage).toBe("Connection refused");
    });

    it("classifies extraction failures based on last stage", () => {
      const initial = getDefaultHvscStatusSummary();
      const summary = applyHvscProgressEventToSummary(
        initial,
        {
          ingestionId: "test",
          stage: "error",
          message: "Disk full",
          errorCause: "ENOSPC",
        },
        "archive_extraction",
      );

      expect(summary.extraction.status).toBe("failure");
      expect(summary.extraction.errorCategory).toBe("storage");
    });

    it("upgrades in-progress statuses to success on complete event (BRDA:170 FALSE, BRDA:175 FALSE)", () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.status = "in-progress";
      initial.extraction.status = "in-progress";

      const result = applyHvscProgressEventToSummary(initial, {
        stage: "complete",
        message: "done",
      });
      expect(result.download.status).toBe("success");
      expect(result.extraction.status).toBe("success");
    });

    it("classifies error without lastStage context (BRDA:183 ?? null)", () => {
      const initial = getDefaultHvscStatusSummary();
      // lastStage omitted → undefined → ?? null fires at line 183
      const result = applyHvscProgressEventToSummary(initial, {
        stage: "error",
        message: "Unclassified error",
      });
      expect(result.extraction.status).toBe("failure");
    });

    it("uses event.message as errorMessage when errorCause is absent (BRDA:184)", () => {
      const initial = getDefaultHvscStatusSummary();
      const result = applyHvscProgressEventToSummary(
        initial,
        {
          stage: "error",
          message: "Fallback message used",
        },
        "archive_extraction",
      );
      expect(result.extraction.errorMessage).toBe("Fallback message used");
    });

    it("uses null errorMessage when bare error event omits both errorCause and message", () => {
      const initial = getDefaultHvscStatusSummary();
      // Covers: errorCause ?? message ?? null → rightmost null branch (L281 slot 2)
      const result = applyHvscProgressEventToSummary(
        initial,
        { stage: "error", ingestionId: "bare-err" },
        "sid_metadata_hydration",
      );
      expect(result.metadata.status).toBe("failure");
      expect(result.metadata.errorMessage).toBeNull();
      expect(result.metadata.durationMs).toBeNull();
      expect(result.metadata.processedSongs).toBeNull();
      expect(result.metadata.totalSongs).toBeNull();
      expect(result.metadata.errorCount).toBeNull();
    });

    it("uses null for optional progress fields when bare sid_metadata_hydration event has no count data", () => {
      const initial = getDefaultHvscStatusSummary();
      // Covers: processedSongs ?? null, totalSongs ?? null, percent fallback to null (L243, L244, L232)
      const result = applyHvscProgressEventToSummary(initial, {
        ingestionId: "bare-progress",
        stage: "sid_metadata_hydration",
        statusToken: "running",
        message: "progress",
      });
      expect(result.metadata.processedSongs).toBeNull();
      expect(result.metadata.totalSongs).toBeNull();
      expect(result.metadata.percent).toBeNull();
      expect(result.metadata.durationMs).toBeNull();
    });

    it("falls back to null errorMessage when status-error progress event has no errorCause or message", () => {
      const initial = getDefaultHvscStatusSummary();
      // Covers: errorCause ?? message ?? null inside stateToken=error branch (L248 slots 1 and 2)
      const result = applyHvscProgressEventToSummary(initial, {
        ingestionId: "err-no-msg",
        stage: "sid_metadata_hydration",
        statusToken: "error",
        // No errorCause, no message
      });
      expect(result.metadata.status).toBe("failure");
      expect(result.metadata.errorMessage).toBeNull();
    });
  });

  describe("recordHvscQueryTiming", () => {
    it("logs query timing with correlation ID and structured fields", () => {
      recordHvscQueryTiming({
        correlationId: "COR-0042",
        phase: "index",
        path: "/MUSICIANS/Hubbard_Rob",
        query: "",
        offset: 0,
        limit: 200,
        resultCount: 47,
        windowMs: 3.14,
        timestamp: "2026-04-04T03:00:00.000Z",
      });

      expect(addLog).toHaveBeenCalledWith("info", "HVSC query timing", {
        correlationId: "COR-0042",
        phase: "index",
        path: "/MUSICIANS/Hubbard_Rob",
        query: "",
        offset: 0,
        limit: 200,
        resultCount: 47,
        windowMs: 3.14,
      });
    });

    it("logs query timing with search query and non-zero offset", () => {
      recordHvscQueryTiming({
        correlationId: "COR-0099",
        phase: "runtime",
        path: "/MUSICIANS",
        query: "commando",
        offset: 200,
        limit: 100,
        resultCount: 3,
        windowMs: 12.5,
        timestamp: "2026-04-04T03:00:01.000Z",
      });

      expect(addLog).toHaveBeenCalledWith("info", "HVSC query timing", {
        correlationId: "COR-0099",
        phase: "runtime",
        path: "/MUSICIANS",
        query: "commando",
        offset: 200,
        limit: 100,
        resultCount: 3,
        windowMs: 12.5,
      });
    });
  });
});
