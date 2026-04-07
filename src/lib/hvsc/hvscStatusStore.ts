/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HvscProgressEvent } from "./hvscTypes";
import { addLog } from "@/lib/logging";

export type HvscFailureCategory =
  | "network"
  | "remote"
  | "download"
  | "extraction"
  | "storage"
  | "corrupt-archive"
  | "unsupported-format"
  | "unknown";

export type HvscStepStatus = "idle" | "in-progress" | "success" | "failure";

export type HvscDownloadStatus = {
  status: HvscStepStatus;
  ingestionId?: string | null;
  archiveName?: string | null;
  lastStage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  sizeBytes?: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  errorCategory?: HvscFailureCategory | null;
  errorMessage?: string | null;
  recoveryHint?: string | null;
};

export type HvscExtractionStatus = {
  status: HvscStepStatus;
  ingestionId?: string | null;
  archiveName?: string | null;
  lastStage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  filesExtracted?: number | null;
  totalFiles?: number | null;
  errorCategory?: HvscFailureCategory | null;
  errorMessage?: string | null;
  recoveryHint?: string | null;
};

export type HvscMetadataHydrationStatus = {
  status: HvscStepStatus;
  ingestionId?: string | null;
  stateToken?: "queued" | "running" | "paused" | "done" | "error" | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  processedSongs?: number | null;
  totalSongs?: number | null;
  percent?: number | null;
  lastFile?: string | null;
  errorCount?: number | null;
  errorMessage?: string | null;
};

export type HvscStatusSummary = {
  download: HvscDownloadStatus;
  extraction: HvscExtractionStatus;
  metadata: HvscMetadataHydrationStatus;
  lastUpdatedAt?: string | null;
};

const STORAGE_KEY = "c64u_hvsc_status:v1";

export const getDefaultHvscStatusSummary = (): HvscStatusSummary => ({
  download: { status: "idle" },
  extraction: { status: "idle" },
  metadata: { status: "idle", stateToken: null },
  lastUpdatedAt: null,
});

export const loadHvscStatusSummary = (): HvscStatusSummary => {
  if (typeof localStorage === "undefined") return getDefaultHvscStatusSummary();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return getDefaultHvscStatusSummary();
  try {
    const parsed = JSON.parse(raw) as HvscStatusSummary;
    if (!parsed?.download || !parsed?.extraction) return getDefaultHvscStatusSummary();
    return {
      ...getDefaultHvscStatusSummary(),
      ...parsed,
      metadata: {
        ...getDefaultHvscStatusSummary().metadata,
        ...(parsed.metadata ?? {}),
      },
    };
  } catch (error) {
    addLog("warn", "Failed to load HVSC status summary", {
      storageKey: STORAGE_KEY,
      error: (error as Error).message,
    });
    return getDefaultHvscStatusSummary();
  }
};

export const saveHvscStatusSummary = (summary: HvscStatusSummary) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
};

export const clearHvscStatusSummary = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
};

const extractionStages = new Set([
  "archive_extraction",
  "archive_validation",
  "sid_enumeration",
  "songlengths",
  "sid_metadata_parsing",
]);

const resolveFailureCategory = (event: HvscProgressEvent, lastStage?: string | null): HvscFailureCategory => {
  const details = `${event.errorType ?? ""} ${event.errorCause ?? ""}`.toLowerCase();
  if (/timeout|network|socket|host|dns|connection|ssl|refused|reset/.test(details)) return "network";
  if (/disk|space|permission|storage|file|io|not found|readonly|denied|enospc|eacces/.test(details)) return "storage";
  if (lastStage === "download") return "download";
  if (lastStage && extractionStages.has(lastStage)) return "extraction";
  return "unknown";
};

const buildRecoveryHint = (category: HvscFailureCategory, stage?: string | null) => {
  if (category === "network" || category === "download") {
    return "Retry the download. If the problem repeats, delete the cached archive and re-download.";
  }
  if (category === "storage") {
    return "Free storage or fix file permissions, then retry the ingest.";
  }
  if (category === "extraction" || category === "corrupt-archive" || stage === "archive_validation") {
    return "Delete the cached archive and retry the ingest from a fresh download.";
  }
  return "Retry the HVSC install or ingest. If it repeats, re-download the archive first.";
};

export const applyHvscProgressEventToSummary = (
  summary: HvscStatusSummary,
  event: HvscProgressEvent,
  lastStage?: string | null,
) => {
  const now = new Date().toISOString();
  const isDownloadComplete =
    event.stage === "download" &&
    ((typeof event.percent === "number" && event.percent >= 100) ||
      (typeof event.downloadedBytes === "number" &&
        typeof event.totalBytes === "number" &&
        event.totalBytes > 0 &&
        event.downloadedBytes >= event.totalBytes));
  if (event.stage === "download") {
    const finishedAt = isDownloadComplete
      ? (summary.download.finishedAt ?? now)
      : (summary.download.finishedAt ?? null);
    return {
      ...summary,
      download: {
        ...summary.download,
        status: isDownloadComplete ? "success" : "in-progress",
        ingestionId: event.ingestionId,
        archiveName: event.archiveName ?? summary.download.archiveName ?? null,
        lastStage: event.stage,
        startedAt: summary.download.startedAt ?? now,
        finishedAt,
        durationMs: event.elapsedTimeMs ?? summary.download.durationMs ?? null,
        sizeBytes:
          event.totalBytes ?? (isDownloadComplete ? event.downloadedBytes : summary.download.sizeBytes) ?? null,
        downloadedBytes: event.downloadedBytes ?? summary.download.downloadedBytes ?? null,
        totalBytes: event.totalBytes ?? summary.download.totalBytes ?? null,
        errorCategory: null,
        errorMessage: null,
        recoveryHint: null,
      },
      lastUpdatedAt: now,
    };
  }

  if (extractionStages.has(event.stage)) {
    return {
      ...summary,
      download:
        summary.download.status === "in-progress"
          ? {
              ...summary.download,
              status: "success",
              finishedAt: summary.download.finishedAt ?? now,
            }
          : summary.download,
      extraction: {
        ...summary.extraction,
        status: "in-progress",
        ingestionId: event.ingestionId,
        archiveName: event.archiveName ?? summary.extraction.archiveName ?? summary.download.archiveName ?? null,
        lastStage: event.stage,
        startedAt: summary.extraction.startedAt ?? now,
        durationMs: event.elapsedTimeMs ?? summary.extraction.durationMs ?? null,
        filesExtracted: event.processedCount ?? summary.extraction.filesExtracted ?? null,
        totalFiles: event.totalCount ?? summary.extraction.totalFiles ?? null,
        errorCategory: null,
        errorMessage: null,
        recoveryHint: null,
      },
    };
  }

  if (event.stage === "sid_metadata_hydration") {
    const stateToken =
      event.statusToken ??
      (typeof event.processedCount === "number" &&
      typeof event.totalCount === "number" &&
      event.totalCount > 0 &&
      event.processedCount >= event.totalCount
        ? "done"
        : "running");
    const percent =
      typeof event.percent === "number"
        ? event.percent
        : typeof event.processedCount === "number" && typeof event.totalCount === "number" && event.totalCount > 0
          ? Math.min(100, (event.processedCount / event.totalCount) * 100)
          : (summary.metadata.percent ?? null);
    return {
      ...summary,
      metadata: {
        ...summary.metadata,
        status: stateToken === "done" ? "success" : stateToken === "error" ? "failure" : "in-progress",
        ingestionId: event.ingestionId,
        stateToken,
        startedAt: summary.metadata.startedAt ?? now,
        finishedAt: stateToken === "done" || stateToken === "error" ? (summary.metadata.finishedAt ?? now) : null,
        durationMs: event.elapsedTimeMs ?? summary.metadata.durationMs ?? null,
        processedSongs: event.processedCount ?? summary.metadata.processedSongs ?? null,
        totalSongs: event.totalCount ?? summary.metadata.totalSongs ?? null,
        percent,
        lastFile: event.currentFile ?? summary.metadata.lastFile ?? null,
        errorCount: event.failedSongs ?? summary.metadata.errorCount ?? null,
        errorMessage: stateToken === "error" ? (event.errorCause ?? event.message ?? null) : null,
      },
      lastUpdatedAt: now,
    };
  }

  if (event.stage === "complete") {
    return {
      ...summary,
      download: {
        ...summary.download,
        status: summary.download.status === "success" ? summary.download.status : "success",
        ingestionId: event.ingestionId,
        archiveName: event.archiveName ?? summary.download.archiveName ?? null,
        lastStage: event.stage,
        finishedAt: summary.download.finishedAt ?? now,
        recoveryHint: null,
      },
      extraction: {
        ...summary.extraction,
        status: summary.extraction.status === "success" ? summary.extraction.status : "success",
        ingestionId: event.ingestionId,
        archiveName: event.archiveName ?? summary.extraction.archiveName ?? summary.download.archiveName ?? null,
        lastStage: event.stage,
        finishedAt: summary.extraction.finishedAt ?? now,
        recoveryHint: null,
      },
      lastUpdatedAt: now,
    };
  }

  if (event.stage === "error") {
    const category = resolveFailureCategory(event, lastStage ?? null);
    const errorMessage = event.errorCause ?? event.message ?? null;
    if (lastStage === "sid_metadata_hydration") {
      return {
        ...summary,
        metadata: {
          ...summary.metadata,
          status: "failure",
          ingestionId: event.ingestionId,
          stateToken: "error",
          finishedAt: now,
          durationMs: event.elapsedTimeMs ?? summary.metadata.durationMs ?? null,
          processedSongs: event.processedCount ?? summary.metadata.processedSongs ?? null,
          totalSongs: event.totalCount ?? summary.metadata.totalSongs ?? null,
          percent: event.percent ?? summary.metadata.percent ?? null,
          lastFile: event.currentFile ?? summary.metadata.lastFile ?? null,
          errorCount: event.failedSongs ?? summary.metadata.errorCount ?? null,
          errorMessage,
        },
        lastUpdatedAt: now,
      };
    }
    if (lastStage === "download") {
      return {
        ...summary,
        download: {
          ...summary.download,
          status: "failure",
          ingestionId: event.ingestionId,
          archiveName: event.archiveName ?? summary.download.archiveName ?? null,
          lastStage: event.stage,
          finishedAt: now,
          errorCategory: category,
          errorMessage,
          recoveryHint: buildRecoveryHint(category, lastStage),
        },
        lastUpdatedAt: now,
      };
    }
    return {
      ...summary,
      extraction: {
        ...summary.extraction,
        status: "failure",
        ingestionId: event.ingestionId,
        archiveName: event.archiveName ?? summary.extraction.archiveName ?? summary.download.archiveName ?? null,
        lastStage: event.stage,
        finishedAt: now,
        errorCategory: category,
        errorMessage,
        recoveryHint: buildRecoveryHint(category, lastStage),
      },
      lastUpdatedAt: now,
    };
  }

  return summary;
};

export const updateHvscStatusSummaryFromEvent = (event: HvscProgressEvent, lastStage?: string | null) => {
  const current = loadHvscStatusSummary();
  const next = applyHvscProgressEventToSummary(current, event, lastStage);
  saveHvscStatusSummary(next);
  return next;
};

export type HvscQueryTimingRecord = {
  correlationId: string;
  phase: string;
  path: string;
  query: string;
  offset: number;
  limit: number;
  resultCount: number;
  windowMs: number;
  timestamp: string;
};

export const recordHvscQueryTiming = (record: HvscQueryTimingRecord) => {
  addLog("info", "HVSC query timing", {
    correlationId: record.correlationId,
    phase: record.phase,
    path: record.path,
    query: record.query,
    offset: record.offset,
    limit: record.limit,
    resultCount: record.resultCount,
    windowMs: record.windowMs,
  });
};
