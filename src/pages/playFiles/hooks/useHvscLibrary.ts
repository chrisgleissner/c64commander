/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import { reportUserError } from "@/lib/uiErrors";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { createActionContext, runWithActionTrace } from "@/lib/tracing/actionTrace";
import {
  addHvscProgressListener,
  cancelHvscInstall,
  checkForHvscUpdates,
  clearHvscStatusSummary,
  describeHvscPreparationTransition,
  getDefaultHvscStatusSummary,
  getHvscCacheStatus,
  getHvscFolderListing,
  ensureHvscMetadataHydration,
  getHvscSong,
  getHvscStatus,
  loadHvscRoot,
  loadHvscStatusSummary,
  resetHvscLibraryData,
  resolveHvscPreparationSnapshot,
  saveHvscStatusSummary,
  ingestCachedHvsc,
  installOrUpdateHvsc,
  isHvscBridgeAvailable,
  recoverStaleIngestionState,
  type HvscPreparationPhase,
  type HvscPreparationSnapshot,
  type HvscPreparationState,
  type HvscFailureCategory,
  type HvscProgressEvent,
  type HvscStatusSummary,
  type HvscStatus,
} from "@/lib/hvsc";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";

export type HvscSong = {
  id: number;
  virtualPath: string;
  fileName: string;
  durationSeconds?: number | null;
};

export type HvscLibraryState = {
  hvscStatus: HvscStatus | null;
  hvscPreparationState: HvscPreparationState;
  hvscPreparationPhase: HvscPreparationPhase;
  hvscPreparationStatusLabel: string;
  hvscPreparationErrorReason: string | null;
  hvscPreparationFailedPhase: HvscPreparationPhase;
  hvscPreparationProgressPercent: number | null;
  hvscPreparationThroughputLabel: string | null;
  hvscReadySongCount: number;
  hvscStatusSummary: HvscStatusSummary;
  hvscRoot: ReturnType<typeof loadHvscRoot>;
  hvscAvailable: boolean;
  hvscLibraryAvailable: boolean;
  hvscCanIngest: boolean;
  hvscPhase: "idle" | "download" | "extract" | "index" | "ready" | "failed";
  hvscFolderFilter: string;
  hvscFolders: string[];
  hvscSongs: HvscSong[];
  selectedHvscFolder: string;
  setHvscFolderFilter: (value: string) => void;
  loadHvscFolder: (path: string) => Promise<void>;
  handleHvscInstall: () => Promise<void>;
  handleHvscIngest: () => Promise<void>;
  handleHvscCancel: () => Promise<void>;
  handleHvscReset: () => Promise<void>;
  handleHvscReindex: () => Promise<void>;
  runHvscPreparation: () => Promise<void>;
  retryHvscPreparation: () => Promise<void>;
  buildHvscLocalPlayFile: (path: string, name: string) => LocalPlayFile;
  formatHvscDuration: (durationMs?: number | null) => string;
  formatHvscTimestamp: (value?: string | null) => string;
  hvscInstalled: boolean;
  hvscInProgress: boolean;
  hvscUpdating: boolean;
  hvscInlineError: string | null;
  hvscSummaryState: "idle" | "success" | "failure";
  hvscSummaryFilesExtracted: number | null | undefined;
  hvscSummaryDurationMs: number | null | undefined;
  hvscSummaryUpdatedAt: string | null | undefined;
  hvscSummaryFailureLabel: string;
  hvscMetadataProgressLabel: string | null;
  hvscMetadataUpdatedAt: string | null | undefined;
  hvscIngestionTotalSongs: number;
  hvscIngestionIngestedSongs: number;
  hvscIngestionFailedSongs: number;
  hvscSonglengthSyntaxErrors: number;
  hvscDownloadPercent: number | null | undefined;
  hvscDownloadBytes: number | null;
  hvscDownloadTotalBytes: number | null;
  hvscDownloadElapsedMs: number | null | undefined;
  hvscDownloadStatus: string;
  hvscExtractionPercent: number | null | undefined;
  hvscExtractionTotalFiles: number | null;
  hvscExtractionElapsedMs: number | null | undefined;
  hvscExtractionStatus: string;
  hvscCurrentFile: string | null;
  hvscActionLabel: string | null;
  hvscStage: string | null;
  hvscVisibleFolders: string[];
};

const HVSC_EXTRACTION_STAGES = new Set([
  "archive_extraction",
  "archive_validation",
  "sid_enumeration",
  "songlengths",
  "sid_metadata_parsing",
]);

const HVSC_READY_MESSAGE = "Ready to use: Add items -> HVSC.";

export const useHvscLibrary = (): HvscLibraryState => {
  const [hvscStatus, setHvscStatus] = useState<HvscStatus | null>(null);
  const [hvscStatusSummary, setHvscStatusSummary] = useState<HvscStatusSummary>(() => loadHvscStatusSummary());
  const [hvscLoading, setHvscLoading] = useState(false);
  const [hvscProgress, setHvscProgress] = useState<number | null>(null);
  const [hvscStage, setHvscStage] = useState<string | null>(null);
  const [hvscActionLabel, setHvscActionLabel] = useState<string | null>(null);
  const [hvscCurrentFile, setHvscCurrentFile] = useState<string | null>(null);
  const [hvscErrorMessage, setHvscErrorMessage] = useState<string | null>(null);
  const [hvscActiveToken, setHvscActiveToken] = useState<"hvsc-install" | "hvsc-ingest" | null>(null);
  const [hvscCacheBaseline, setHvscCacheBaseline] = useState<number | null>(null);
  const [hvscCacheUpdates, setHvscCacheUpdates] = useState<number[]>([]);
  const [hvscExtractionFiles, setHvscExtractionFiles] = useState<number | null>(null);
  const [hvscExtractionTotal, setHvscExtractionTotal] = useState<number | null>(null);
  const [hvscElapsedNow, setHvscElapsedNow] = useState(() => Date.now());
  const [hvscFolderFilter, setHvscFolderFilter] = useState("");
  const [hvscFolders, setHvscFolders] = useState<string[]>([]);
  const [hvscSongs, setHvscSongs] = useState<HvscSong[]>([]);
  const [selectedHvscFolder, setSelectedHvscFolder] = useState("/");
  const hvscLastStageRef = useRef<string | null>(null);
  const hvscProgressThrottleRef = useRef(0);
  const hvscDownloadPendingRef = useRef<HvscProgressEvent | null>(null);
  const hvscDownloadTimerRef = useRef<number | null>(null);
  const hvscExtractionPendingRef = useRef<{
    processedCount?: number;
    totalCount?: number;
  } | null>(null);
  const hvscExtractionTimerRef = useRef<number | null>(null);
  const hvscExtractionThrottleRef = useRef(0);
  const hvscIgnoreProgressRef = useRef(false);

  const runHvscAction = useCallback(<T>(name: string, fn: () => Promise<T> | T) => {
    const context = createActionContext(name, "user", "HvscLibrary");
    return runWithActionTrace(context, fn);
  }, []);

  const updateHvscSummary = useCallback((updater: (prev: HvscStatusSummary) => HvscStatusSummary) => {
    setHvscStatusSummary((prev) => {
      const next = updater(prev);
      saveHvscStatusSummary(next);
      return next;
    });
  }, []);

  const clearPendingHvscProgress = useCallback(() => {
    hvscDownloadPendingRef.current = null;
    if (hvscDownloadTimerRef.current !== null) {
      window.clearTimeout(hvscDownloadTimerRef.current);
      hvscDownloadTimerRef.current = null;
    }
    hvscExtractionPendingRef.current = null;
    if (hvscExtractionTimerRef.current !== null) {
      window.clearTimeout(hvscExtractionTimerRef.current);
      hvscExtractionTimerRef.current = null;
    }
    hvscProgressThrottleRef.current = 0;
    hvscExtractionThrottleRef.current = 0;
  }, []);

  // Best-effort categorization based on error messages; update if upstream errors change.
  const resolveHvscFailureCategory = useCallback(
    (event: HvscProgressEvent, lastStage: string | null): HvscFailureCategory => {
      const details = `${event.errorType ?? ""} ${event.errorCause ?? ""}`.toLowerCase();
      const isNetwork = /timeout|network|socket|host|dns|connection|ssl|refused|reset/.test(details);
      const isStorage = /disk|space|permission|storage|file|io|not found|readonly|denied|enospc|eacces/.test(details);
      if (isNetwork) return "network";
      if (isStorage) return "storage";
      if (lastStage === "download") return "download";
      if (
        lastStage === "archive_extraction" ||
        lastStage === "archive_validation" ||
        lastStage === "sid_enumeration" ||
        lastStage === "songlengths" ||
        lastStage === "sid_metadata_parsing"
      ) {
        return "extraction";
      }
      return "unknown";
    },
    [],
  );

  const formatHvscDuration = (durationMs?: number | null) => {
    if (!durationMs && durationMs !== 0) return "—";
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const formatHvscTimestamp = (value?: string | null) => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
  };

  const buildHvscLocalPlayFile = useCallback(
    (path: string, name: string): LocalPlayFile => ({
      name,
      webkitRelativePath: path,
      lastModified: Date.now(),
      arrayBuffer: async () => {
        const detail = await getHvscSong({ virtualPath: path });
        const data = base64ToUint8(detail.dataBase64);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
    }),
    [],
  );

  const refreshHvscStatus = useCallback(() => {
    if (!isHvscBridgeAvailable()) return;
    getHvscStatus()
      .then(setHvscStatus)
      .catch((error) => {
        addErrorLog("HVSC status fetch failed", {
          error: (error as Error).message,
        });
        setHvscStatus(null);
      });
  }, []);

  useEffect(() => {
    recoverStaleIngestionState();
  }, []);

  useEffect(() => {
    refreshHvscStatus();
  }, [refreshHvscStatus]);

  useEffect(() => {
    if (!hvscStatus?.installedVersion) return;
    if (hvscStatus.ingestionState !== "ready") return;
    void ensureHvscMetadataHydration().catch((error) => {
      addErrorLog("Failed to ensure HVSC metadata hydration", {
        error: (error as Error).message,
      });
    });
  }, [hvscStatus?.ingestionState, hvscStatus?.installedVersion]);

  const refreshHvscCacheStatus = useCallback(() => {
    if (!isHvscBridgeAvailable()) return;
    getHvscCacheStatus()
      .then((cache) => {
        setHvscCacheBaseline(cache.baselineVersion ?? null);
        setHvscCacheUpdates(cache.updateVersions ?? []);
      })
      .catch((error) => {
        addErrorLog("HVSC cache status fetch failed", {
          error: (error as Error).message,
        });
        setHvscCacheBaseline(null);
        setHvscCacheUpdates([]);
      });
  }, []);

  useEffect(() => {
    refreshHvscCacheStatus();
  }, [refreshHvscCacheStatus, hvscStatus?.installedVersion, hvscStatus?.ingestionState]);

  useEffect(() => {
    if (!hvscStatus) return;
    const summaryInProgress =
      hvscStatusSummary.download.status === "in-progress" || hvscStatusSummary.extraction.status === "in-progress";
    const activeIngestion = ["installing", "updating"].includes(hvscStatus.ingestionState);
    const lastUpdatedAtMs = hvscStatusSummary.lastUpdatedAt ? Date.parse(hvscStatusSummary.lastUpdatedAt) : null;
    const isStale = lastUpdatedAtMs ? Date.now() - lastUpdatedAtMs > 15000 : true;
    if (!summaryInProgress || activeIngestion || !isStale) return;

    const now = new Date().toISOString();
    updateHvscSummary((prev) => ({
      ...prev,
      download:
        prev.download.status === "in-progress"
          ? {
              ...prev.download,
              status: "failure",
              finishedAt: now,
              errorCategory: prev.download.errorCategory ?? "unknown",
              errorMessage: prev.download.errorMessage ?? "Interrupted",
            }
          : prev.download,
      extraction:
        prev.extraction.status === "in-progress"
          ? {
              ...prev.extraction,
              status: "failure",
              finishedAt: now,
              errorCategory: prev.extraction.errorCategory ?? "unknown",
              errorMessage: prev.extraction.errorMessage ?? "Interrupted",
            }
          : prev.extraction,
      lastUpdatedAt: now,
    }));
    addLog("warn", "HVSC progress interrupted", {
      ingestionState: hvscStatus.ingestionState,
      downloadStatus: hvscStatusSummary.download.status,
      extractionStatus: hvscStatusSummary.extraction.status,
    });
  }, [hvscStatus, hvscStatusSummary, updateHvscSummary]);

  useEffect(() => {
    if (!isHvscBridgeAvailable()) return;
    let removeListener: (() => Promise<void>) | null = null;
    let disposed = false;
    const registration = addHvscProgressListener((event) => {
      if (hvscIgnoreProgressRef.current) return;
      const now = new Date().toISOString();
      const lastStage = hvscLastStageRef.current;
      const applyExtractionCounts = (payload: { processedCount?: number; totalCount?: number }) => {
        if (typeof payload.processedCount === "number" && payload.processedCount > 0) {
          setHvscExtractionFiles((prev) =>
            prev === null ? payload.processedCount : Math.max(prev, payload.processedCount),
          );
        }
        if (typeof payload.totalCount === "number" && payload.totalCount > 0) {
          setHvscExtractionTotal((prev) => (prev === null ? payload.totalCount : Math.max(prev, payload.totalCount)));
        }
      };
      const isDownloadComplete = (payload: HvscProgressEvent) =>
        payload.stage === "download" &&
        ((typeof payload.percent === "number" && payload.percent >= 100) ||
          (typeof payload.downloadedBytes === "number" &&
            typeof payload.totalBytes === "number" &&
            payload.totalBytes > 0 &&
            payload.downloadedBytes >= payload.totalBytes));
      if (event.stage && event.stage !== "error") {
        hvscLastStageRef.current = event.stage;
      }
      const nowMs = Date.now();
      const shouldUpdate =
        event.stage === "complete" ||
        event.stage === "error" ||
        event.stage !== lastStage ||
        nowMs - hvscProgressThrottleRef.current >= 120;
      const shouldUpdateSummary =
        shouldUpdate ||
        typeof event.downloadedBytes === "number" ||
        typeof event.totalBytes === "number" ||
        typeof event.processedCount === "number" ||
        typeof event.totalCount === "number";
      if (shouldUpdate) {
        hvscProgressThrottleRef.current = nowMs;
        if (event.message) setHvscActionLabel(event.message);
        if (event.stage) setHvscStage(event.stage);
        if (typeof event.percent === "number") setHvscProgress(event.percent);
        if (event.currentFile) setHvscCurrentFile(event.currentFile);
      }
      if (event.errorCause) setHvscErrorMessage(event.errorCause);
      if (typeof event.processedCount === "number" || typeof event.totalCount === "number") {
        const elapsed = nowMs - hvscExtractionThrottleRef.current;
        if (elapsed >= 120) {
          hvscExtractionThrottleRef.current = nowMs;
          if (hvscExtractionTimerRef.current !== null) {
            window.clearTimeout(hvscExtractionTimerRef.current);
            hvscExtractionTimerRef.current = null;
          }
          hvscExtractionPendingRef.current = null;
          applyExtractionCounts(event);
        } else {
          const pending = hvscExtractionPendingRef.current;
          const nextProcessed =
            typeof event.processedCount === "number" && event.processedCount > 0
              ? Math.max(pending?.processedCount ?? Number.NEGATIVE_INFINITY, event.processedCount)
              : pending?.processedCount;
          const nextTotal =
            typeof event.totalCount === "number" && event.totalCount > 0
              ? Math.max(pending?.totalCount ?? Number.NEGATIVE_INFINITY, event.totalCount)
              : pending?.totalCount;
          hvscExtractionPendingRef.current = {
            ...(typeof nextProcessed === "number" ? { processedCount: nextProcessed } : {}),
            ...(typeof nextTotal === "number" ? { totalCount: nextTotal } : {}),
          };
          if (hvscExtractionTimerRef.current === null) {
            const delayMs = Math.max(0, 120 - elapsed);
            hvscExtractionTimerRef.current = window.setTimeout(() => {
              const pending = hvscExtractionPendingRef.current;
              hvscExtractionPendingRef.current = null;
              hvscExtractionTimerRef.current = null;
              hvscExtractionThrottleRef.current = Date.now();
              if (pending) {
                applyExtractionCounts(pending);
              }
            }, delayMs);
          }
        }
      }
      if (event.stage === "download") {
        const applyDownloadSummary = (payload: HvscProgressEvent) => {
          const completed = isDownloadComplete(payload);
          updateHvscSummary((prev) => ({
            ...prev,
            download: {
              ...prev.download,
              status: completed ? "success" : "in-progress",
              startedAt: prev.download.startedAt ?? now,
              finishedAt: completed ? (prev.download.finishedAt ?? now) : (prev.download.finishedAt ?? null),
              durationMs: payload.elapsedTimeMs ?? prev.download.durationMs ?? null,
              sizeBytes: payload.totalBytes ?? (completed ? payload.downloadedBytes : prev.download.sizeBytes) ?? null,
              downloadedBytes: payload.downloadedBytes ?? prev.download.downloadedBytes ?? null,
              totalBytes: payload.totalBytes ?? prev.download.totalBytes ?? null,
              errorCategory: null,
              errorMessage: null,
            },
            lastUpdatedAt: now,
          }));
        };

        if (shouldUpdate) {
          if (hvscDownloadTimerRef.current !== null) {
            window.clearTimeout(hvscDownloadTimerRef.current);
            hvscDownloadTimerRef.current = null;
          }
          hvscDownloadPendingRef.current = null;
          applyDownloadSummary(event);
        } else {
          hvscDownloadPendingRef.current = event;
          if (hvscDownloadTimerRef.current === null) {
            const delayMs = Math.max(0, 120 - (nowMs - hvscProgressThrottleRef.current));
            hvscDownloadTimerRef.current = window.setTimeout(() => {
              const pending = hvscDownloadPendingRef.current;
              hvscDownloadPendingRef.current = null;
              hvscDownloadTimerRef.current = null;
              if (pending) {
                applyDownloadSummary(pending);
              }
            }, delayMs);
          }
        }
      }
      if (
        event.stage === "archive_extraction" ||
        event.stage === "archive_validation" ||
        event.stage === "sid_enumeration" ||
        event.stage === "songlengths" ||
        event.stage === "sid_metadata_parsing"
      ) {
        if (shouldUpdateSummary) {
          updateHvscSummary((prev) => ({
            ...prev,
            download:
              prev.download.status === "in-progress"
                ? {
                    ...prev.download,
                    status: "success",
                    finishedAt: prev.download.finishedAt ?? now,
                  }
                : prev.download,
            extraction: {
              ...prev.extraction,
              status: "in-progress",
              startedAt: prev.extraction.startedAt ?? now,
              durationMs: event.elapsedTimeMs ?? prev.extraction.durationMs ?? null,
              filesExtracted: event.processedCount ?? prev.extraction.filesExtracted ?? null,
              totalFiles: event.totalCount ?? prev.extraction.totalFiles ?? null,
              errorCategory: null,
              errorMessage: null,
            },
          }));
        }
      }
      if (event.stage === "sid_metadata_hydration") {
        updateHvscSummary((prev) => ({
          ...prev,
          metadata: {
            ...prev.metadata,
            status:
              event.statusToken === "done" ? "success" : event.statusToken === "error" ? "failure" : "in-progress",
            ingestionId: event.ingestionId,
            stateToken: event.statusToken ?? prev.metadata.stateToken ?? "running",
            startedAt: prev.metadata.startedAt ?? now,
            finishedAt:
              event.statusToken === "done" || event.statusToken === "error" ? (prev.metadata.finishedAt ?? now) : null,
            durationMs: event.elapsedTimeMs ?? prev.metadata.durationMs ?? null,
            processedSongs: event.processedCount ?? prev.metadata.processedSongs ?? null,
            totalSongs: event.totalCount ?? prev.metadata.totalSongs ?? null,
            percent: typeof event.percent === "number" ? event.percent : (prev.metadata.percent ?? null),
            lastFile: event.currentFile ?? prev.metadata.lastFile ?? null,
            errorCount: event.failedSongs ?? prev.metadata.errorCount ?? null,
            errorMessage: event.statusToken === "error" ? (event.errorCause ?? event.message ?? null) : null,
          },
          lastUpdatedAt: now,
        }));
      }
      if (event.stage === "complete") {
        updateHvscSummary((prev) => ({
          ...prev,
          download: {
            ...prev.download,
            status: prev.download.status === "success" ? prev.download.status : "success",
            finishedAt: prev.download.finishedAt ?? now,
          },
          extraction: {
            ...prev.extraction,
            status: prev.extraction.status === "success" ? prev.extraction.status : "success",
            finishedAt: prev.extraction.finishedAt ?? now,
          },
          lastUpdatedAt: now,
        }));
      }
      if (event.stage === "error") {
        const category = resolveHvscFailureCategory(event, lastStage);
        const errorMessage = event.errorCause ?? event.message ?? null;
        updateHvscSummary((prev) => {
          if (lastStage === "download") {
            return {
              ...prev,
              download: {
                ...prev.download,
                status: "failure",
                finishedAt: now,
                errorCategory: category,
                errorMessage,
              },
              lastUpdatedAt: now,
            };
          }
          return {
            ...prev,
            extraction: {
              ...prev.extraction,
              status: "failure",
              finishedAt: now,
              errorCategory: category,
              errorMessage,
            },
            lastUpdatedAt: now,
          };
        });
      }
      if (event.stage === "songlengths") {
        addLog("info", "HVSC songlengths source loaded", {
          message: event.message,
          archiveName: event.archiveName,
        });
      }
    });
    void registration
      .then(async (handler) => {
        if (disposed) {
          await handler.remove();
          return;
        }
        removeListener = handler.remove;
      })
      .catch((error) => {
        addErrorLog("HVSC progress listener registration failed", {
          error: (error as Error).message,
        });
      });
    return () => {
      disposed = true;
      clearPendingHvscProgress();
      if (removeListener) {
        void removeListener();
      }
    };
  }, [clearPendingHvscProgress, resolveHvscFailureCategory, updateHvscSummary]);

  const loadHvscFolder = useCallback(async (path: string) => {
    try {
      const listing = await getHvscFolderListing(path);
      setHvscFolders(listing.folders);
      setHvscSongs(listing.songs);
      setSelectedHvscFolder(listing.path);
    } catch (error) {
      reportUserError({
        operation: "HVSC_BROWSE",
        title: "HVSC browse failed",
        description: (error as Error).message,
        error,
        context: { path },
      });
    }
  }, []);

  useEffect(() => {
    if (!hvscStatus?.installedVersion) return;
    if (hvscFolders.length || hvscSongs.length) return;
    void loadHvscFolder(selectedHvscFolder || "/");
  }, [hvscStatus?.installedVersion, hvscFolders.length, hvscSongs.length, loadHvscFolder, selectedHvscFolder]);

  const handleHvscInstall = useCallback(
    () =>
      runHvscAction("HvscLibrary.handleHvscInstall", async () => {
        try {
          const startedAt = new Date().toISOString();
          hvscIgnoreProgressRef.current = false;
          clearPendingHvscProgress();
          setHvscActiveToken("hvsc-install");
          setHvscLoading(true);
          setHvscProgress(0);
          setHvscStage(null);
          setHvscErrorMessage(null);
          setHvscActionLabel("Checking for updates…");
          setHvscExtractionFiles(null);
          setHvscExtractionTotal(null);
          updateHvscSummary((prev) => ({
            ...prev,
            download: {
              ...prev.download,
              status: "in-progress",
              startedAt,
              finishedAt: null,
              durationMs: null,
              errorCategory: null,
              errorMessage: null,
            },
            extraction: {
              ...prev.extraction,
              status: prev.extraction.status === "success" ? prev.extraction.status : "idle",
              errorCategory: null,
              errorMessage: null,
            },
            lastUpdatedAt: startedAt,
          }));
          const updateStatus = await checkForHvscUpdates();
          if (!updateStatus.requiredUpdates.length && updateStatus.installedVersion > 0) {
            toast({
              title: "HVSC up to date",
              description: "No new updates detected.",
            });
            const status = await getHvscStatus();
            setHvscStatus(status);
            const finishedAt = new Date().toISOString();
            updateHvscSummary((prev) => ({
              ...prev,
              download: {
                ...prev.download,
                status: "success",
                finishedAt,
                errorCategory: null,
                errorMessage: null,
              },
              extraction: {
                ...prev.extraction,
                status: "success",
                finishedAt,
                errorCategory: null,
                errorMessage: null,
              },
              lastUpdatedAt: finishedAt,
            }));
            void recordSmokeBenchmarkSnapshot({
              scenario: "install",
              state: "up-to-date",
              metadata: {
                installedVersion: status.installedVersion,
                ingestionState: status.ingestionState,
                totalSongs: status.ingestionSummary?.totalSongs ?? null,
                ingestedSongs: status.ingestionSummary?.ingestedSongs ?? null,
                feedbackKind: "progress",
                feedbackVisibleWithinMs: 0,
                feedbackWithinBudget: true,
              },
            });
            refreshHvscStatus();
            return;
          }
          setHvscActionLabel(updateStatus.installedVersion ? "Applying updates…" : "Installing HVSC…");
          await installOrUpdateHvsc("hvsc-install");
          const status = await getHvscStatus();
          setHvscStatus(status);
          const finishedAt = new Date().toISOString();
          updateHvscSummary((prev) => ({
            ...prev,
            download: {
              ...prev.download,
              status: "success",
              finishedAt,
              errorCategory: null,
              errorMessage: null,
            },
            extraction: {
              ...prev.extraction,
              status: "success",
              finishedAt,
              errorCategory: null,
              errorMessage: null,
            },
            lastUpdatedAt: finishedAt,
          }));
          void recordSmokeBenchmarkSnapshot({
            scenario: "install",
            state: "complete",
            metadata: {
              installedVersion: status.installedVersion,
              ingestionState: status.ingestionState,
              totalSongs: status.ingestionSummary?.totalSongs ?? null,
              ingestedSongs: status.ingestionSummary?.ingestedSongs ?? null,
              songlengthSyntaxErrors: status.ingestionSummary?.songlengthSyntaxErrors ?? null,
              feedbackKind: "progress",
              feedbackVisibleWithinMs: 0,
              feedbackWithinBudget: true,
            },
          });
          toast({
            title: "HVSC ready",
            description: HVSC_READY_MESSAGE,
          });
        } catch (error) {
          if (/cancelled/i.test((error as Error).message)) {
            const cancelledAt = new Date().toISOString();
            updateHvscSummary((prev) => ({
              ...prev,
              download: {
                ...prev.download,
                status: "failure",
                finishedAt: cancelledAt,
                errorCategory: null,
                errorMessage: null,
              },
              lastUpdatedAt: cancelledAt,
            }));
            return;
          }
          const failedAt = new Date().toISOString();
          setHvscErrorMessage((error as Error).message);
          updateHvscSummary((prev) => ({
            ...prev,
            download: {
              ...prev.download,
              status: "failure",
              finishedAt: failedAt,
              errorCategory: "download",
              errorMessage: (error as Error).message,
            },
            lastUpdatedAt: failedAt,
          }));
          reportUserError({
            operation: "HVSC_DOWNLOAD",
            title: "HVSC update failed",
            description: (error as Error).message,
            error,
          });
        } finally {
          setHvscLoading(false);
          setHvscActiveToken(null);
          refreshHvscCacheStatus();
        }
      }),
    [clearPendingHvscProgress, refreshHvscCacheStatus, refreshHvscStatus, runHvscAction, updateHvscSummary],
  );

  const hvscHasCache =
    Boolean(hvscCacheBaseline) || hvscCacheUpdates.length > 0 || hvscStatusSummary.extraction.status === "success";

  const handleHvscIngest = useCallback(
    () =>
      runHvscAction("HvscLibrary.handleHvscIngest", async () => {
        if (!isHvscBridgeAvailable()) return;
        if (!hvscHasCache) {
          toast({
            title: "HVSC cache missing",
            description: "Download HVSC first, then ingest cached updates.",
          });
          return;
        }
        try {
          const startedAt = new Date().toISOString();
          hvscIgnoreProgressRef.current = false;
          clearPendingHvscProgress();
          setHvscActiveToken("hvsc-ingest");
          setHvscLoading(true);
          setHvscProgress(0);
          setHvscStage(null);
          setHvscErrorMessage(null);
          setHvscActionLabel("Ingesting cached HVSC…");
          setHvscExtractionFiles(null);
          setHvscExtractionTotal(null);
          updateHvscSummary((prev) => ({
            ...prev,
            extraction: {
              ...prev.extraction,
              status: "in-progress",
              startedAt,
              finishedAt: null,
              durationMs: null,
              errorCategory: null,
              errorMessage: null,
            },
            lastUpdatedAt: startedAt,
          }));
          await ingestCachedHvsc("hvsc-ingest");
          const status = await getHvscStatus();
          setHvscStatus(status);
          const finishedAt = new Date().toISOString();
          updateHvscSummary((prev) => ({
            ...prev,
            extraction: {
              ...prev.extraction,
              status: "success",
              finishedAt,
              errorCategory: null,
              errorMessage: null,
            },
            lastUpdatedAt: finishedAt,
          }));
          void recordSmokeBenchmarkSnapshot({
            scenario: "ingest",
            state: "complete",
            metadata: {
              installedVersion: status.installedVersion,
              ingestionState: status.ingestionState,
              totalSongs: status.ingestionSummary?.totalSongs ?? null,
              ingestedSongs: status.ingestionSummary?.ingestedSongs ?? null,
              songlengthSyntaxErrors: status.ingestionSummary?.songlengthSyntaxErrors ?? null,
              feedbackKind: "progress",
              feedbackVisibleWithinMs: 0,
              feedbackWithinBudget: true,
            },
          });
          toast({
            title: "HVSC ready",
            description: HVSC_READY_MESSAGE,
          });
        } catch (error) {
          if (/cancelled/i.test((error as Error).message)) {
            const cancelledAt = new Date().toISOString();
            updateHvscSummary((prev) => ({
              ...prev,
              extraction: {
                ...prev.extraction,
                status: "failure",
                finishedAt: cancelledAt,
                errorCategory: null,
                errorMessage: null,
              },
              lastUpdatedAt: cancelledAt,
            }));
            return;
          }
          const failedAt = new Date().toISOString();
          setHvscErrorMessage((error as Error).message);
          updateHvscSummary((prev) => ({
            ...prev,
            extraction: {
              ...prev.extraction,
              status: "failure",
              finishedAt: failedAt,
              errorCategory: "extraction",
              errorMessage: (error as Error).message,
            },
            lastUpdatedAt: failedAt,
          }));
          reportUserError({
            operation: "HVSC_INGEST",
            title: "HVSC ingest failed",
            description: (error as Error).message,
            error,
          });
        } finally {
          setHvscLoading(false);
          setHvscActiveToken(null);
          refreshHvscCacheStatus();
        }
      }),
    [clearPendingHvscProgress, hvscHasCache, refreshHvscCacheStatus, runHvscAction, updateHvscSummary],
  );

  const handleHvscCancel = useCallback(async () => {
    const token = hvscActiveToken ?? "hvsc-install";
    try {
      await cancelHvscInstall(token);
      const stoppedAt = new Date().toISOString();
      hvscIgnoreProgressRef.current = true;
      clearPendingHvscProgress();
      setHvscLoading(false);
      setHvscProgress(null);
      setHvscStage(null);
      setHvscActionLabel(null);
      setHvscCurrentFile(null);
      setHvscErrorMessage("Cancelled");
      updateHvscSummary((prev) => ({
        ...prev,
        download:
          prev.download.status === "in-progress"
            ? {
                ...prev.download,
                status: "idle",
                finishedAt: stoppedAt,
                durationMs: null,
                downloadedBytes: null,
                totalBytes: null,
                sizeBytes: null,
                errorCategory: null,
                errorMessage: "Cancelled",
              }
            : prev.download,
        extraction:
          prev.extraction.status === "in-progress"
            ? {
                ...prev.extraction,
                status: "idle",
                finishedAt: stoppedAt,
                durationMs: null,
                filesExtracted: null,
                totalFiles: null,
                errorCategory: null,
                errorMessage: "Cancelled",
              }
            : prev.extraction,
        lastUpdatedAt: stoppedAt,
      }));
      try {
        const status = await getHvscStatus();
        setHvscStatus(status);
      } catch (error) {
        addErrorLog("HVSC status refresh failed after cancel", {
          error: (error as Error).message,
        });
      }
      setHvscActiveToken(null);
      toast({ title: "HVSC update cancelled" });
    } catch (error) {
      reportUserError({
        operation: "HVSC_CANCEL",
        title: "Cancel failed",
        description: (error as Error).message,
        error,
      });
    }
  }, [clearPendingHvscProgress, hvscActiveToken, updateHvscSummary]);

  const handleHvscReset = useCallback(
    () =>
      runHvscAction("HvscLibrary.handleHvscReset", async () => {
        try {
          hvscIgnoreProgressRef.current = false;
          clearPendingHvscProgress();
          setHvscLoading(true);
          setHvscActiveToken(null);
          await resetHvscLibraryData();
          clearHvscStatusSummary();
          setHvscStatusSummary(getDefaultHvscStatusSummary());
          setHvscStatus({
            installedBaselineVersion: null,
            installedVersion: 0,
            ingestionState: "idle",
            lastUpdateCheckUtcMs: null,
            ingestionError: null,
            ingestionSummary: null,
          });
          setHvscErrorMessage(null);
          setHvscProgress(null);
          setHvscStage(null);
          setHvscActionLabel(null);
          setHvscCurrentFile(null);
          setHvscExtractionFiles(null);
          setHvscExtractionTotal(null);
          setHvscFolders([]);
          setHvscSongs([]);
          setSelectedHvscFolder("/");
          setHvscFolderFilter("");
          refreshHvscCacheStatus();
          toast({
            title: "HVSC reset",
            description: "The cached HVSC archives and indexed library were removed.",
          });
        } catch (error) {
          reportUserError({
            operation: "HVSC_RESET",
            title: "HVSC reset failed",
            description: (error as Error).message,
            error,
          });
        } finally {
          setHvscLoading(false);
        }
      }),
    [clearPendingHvscProgress, refreshHvscCacheStatus, runHvscAction],
  );

  const handleHvscReindex = useCallback(async () => {
    await handleHvscIngest();
  }, [handleHvscIngest]);

  const hvscRoot = useMemo(() => loadHvscRoot(), []);
  const hvscAvailable = isHvscBridgeAvailable();
  const hvscLibraryAvailable =
    hvscAvailable &&
    (Boolean(hvscStatus?.installedVersion) ||
      (hvscStatusSummary.download.status === "success" && hvscStatusSummary.extraction.status === "success"));

  const hvscInstalled = Boolean(hvscStatus?.installedVersion);
  const hvscInProgress =
    hvscStatusSummary.download.status === "in-progress" ||
    hvscStatusSummary.extraction.status === "in-progress" ||
    hvscStatus?.ingestionState === "installing" ||
    hvscStatus?.ingestionState === "updating";
  const hvscUpdating = hvscLoading || hvscInProgress;
  const hvscInlineError =
    hvscErrorMessage || (hvscStatus?.ingestionState === "error" ? hvscStatus.ingestionError : null);
  const hvscCanIngest = hvscAvailable && hvscHasCache && !hvscUpdating;
  const hvscSummaryState = useMemo(() => {
    if (hvscStatusSummary.download.status === "failure" || hvscStatusSummary.extraction.status === "failure")
      return "failure";
    if (hvscStatusSummary.download.status === "success" || hvscStatusSummary.extraction.status === "success")
      return "success";
    return "idle";
  }, [hvscStatusSummary]);
  const hvscPhase = useMemo(() => {
    if (hvscUpdating) {
      if (hvscStage === "download" || hvscStatusSummary.download.status === "in-progress") return "download";
      if (hvscStage === "sid_metadata_hydration" || hvscStatusSummary.metadata.status === "in-progress") {
        return "index";
      }
      if (hvscStage && HVSC_EXTRACTION_STAGES.has(hvscStage)) {
        if (hvscStage === "sid_enumeration" || hvscStage === "songlengths" || hvscStage === "sid_metadata_parsing") {
          return "index";
        }
        return "extract";
      }
      if (hvscStatusSummary.extraction.status === "in-progress") return "extract";
      return "download";
    }
    if (hvscStage === "sid_metadata_hydration" || hvscStatusSummary.metadata.status === "in-progress") return "index";
    if (hvscSummaryState === "failure" || hvscInlineError) return "failed";
    if (hvscSummaryState === "success" || hvscInstalled) return "ready";
    return "idle";
  }, [
    hvscInlineError,
    hvscInstalled,
    hvscStage,
    hvscSummaryState,
    hvscStatusSummary.download.status,
    hvscStatusSummary.extraction.status,
    hvscStatusSummary.metadata.status,
    hvscUpdating,
  ]);
  const hvscSummaryFailureCategory =
    hvscStatusSummary.extraction.status === "failure"
      ? hvscStatusSummary.extraction.errorCategory
      : hvscStatusSummary.download.errorCategory;
  const hvscSummaryFailureLabel = useMemo(() => {
    switch (hvscSummaryFailureCategory) {
      case "network":
        return "Network error";
      case "storage":
        return "Storage error";
      case "download":
        return "Download error";
      case "extraction":
      case "corrupt-archive":
      case "unsupported-format":
        return "Extraction error";
      default:
        return "Download error";
    }
  }, [hvscSummaryFailureCategory]);
  const hvscSummaryDurationMs = hvscStatusSummary.extraction.durationMs ?? hvscStatusSummary.download.durationMs;
  const hvscSummaryUpdatedAt = hvscStatusSummary.lastUpdatedAt;
  const hvscMetadataProgressLabel = (() => {
    const processedSongs = hvscStatusSummary.metadata.processedSongs ?? 0;
    const totalSongs = hvscStatusSummary.metadata.totalSongs ?? 0;
    const stateToken = hvscStatusSummary.metadata.stateToken;
    if (!totalSongs && stateToken !== "done") return null;
    return `HVSC META ${processedSongs.toLocaleString()}/${totalSongs.toLocaleString()} ${stateToken ?? "queued"}`;
  })();
  const hvscMetadataUpdatedAt = hvscStatusSummary.metadata.finishedAt ?? hvscStatusSummary.metadata.startedAt;
  const hvscIngestionTotalSongs = hvscStatus?.ingestionSummary?.totalSongs ?? 0;
  const hvscIngestionIngestedSongs = hvscStatus?.ingestionSummary?.ingestedSongs ?? 0;
  const hvscIngestionFailedSongs = hvscStatus?.ingestionSummary?.failedSongs ?? 0;
  const hvscSonglengthSyntaxErrors = hvscStatus?.ingestionSummary?.songlengthSyntaxErrors ?? 0;
  const hvscDownloadBytes = hvscStatusSummary.download.downloadedBytes ?? null;
  const hvscDownloadTotalBytes = hvscStatusSummary.download.totalBytes ?? hvscStatusSummary.download.sizeBytes ?? null;
  const hvscExtractionTotalFiles =
    hvscExtractionTotal !== null
      ? Math.max(hvscStatusSummary.extraction.totalFiles ?? 0, hvscExtractionTotal)
      : (hvscStatusSummary.extraction.totalFiles ?? null);
  const hvscProgressDerivedFiles =
    hvscStage && HVSC_EXTRACTION_STAGES.has(hvscStage) && hvscExtractionTotalFiles && typeof hvscProgress === "number"
      ? Math.max(0, Math.round((hvscProgress / 100) * hvscExtractionTotalFiles))
      : null;
  const hvscSummaryFilesExtracted = (() => {
    const direct =
      hvscExtractionFiles !== null
        ? Math.max(hvscStatusSummary.extraction.filesExtracted ?? 0, hvscExtractionFiles)
        : (hvscStatusSummary.extraction.filesExtracted ?? null);
    if (typeof hvscProgressDerivedFiles === "number") {
      if (direct === null) return hvscProgressDerivedFiles;
      return Math.max(direct, hvscProgressDerivedFiles);
    }
    const stageFloor = hvscStage === "sid_metadata_parsing" || hvscStage === "songlengths" ? 1 : null;
    if (stageFloor !== null) {
      if (direct === null) return stageFloor;
      return Math.max(direct, stageFloor);
    }
    if (direct === null && hvscExtractionTotalFiles && hvscUpdating) {
      return 1;
    }
    return direct;
  })();

  const resolveElapsedMs = useCallback(
    (startedAt?: string | null, fallback?: number | null) => {
      if (startedAt) {
        const started = new Date(startedAt).getTime();
        if (!Number.isNaN(started)) {
          return Math.max(0, hvscElapsedNow - started);
        }
      }
      return fallback ?? null;
    },
    [hvscElapsedNow],
  );

  const hvscDownloadElapsedMs =
    hvscStatusSummary.download.status === "in-progress"
      ? resolveElapsedMs(hvscStatusSummary.download.startedAt, hvscStatusSummary.download.durationMs)
      : hvscStatusSummary.download.durationMs;
  const hvscExtractionElapsedMs =
    hvscStatusSummary.extraction.status === "in-progress"
      ? resolveElapsedMs(hvscStatusSummary.extraction.startedAt, hvscStatusSummary.extraction.durationMs)
      : hvscStatusSummary.extraction.durationMs;

  const hvscDownloadPercent =
    hvscDownloadBytes !== null && hvscDownloadTotalBytes
      ? Math.min(100, (hvscDownloadBytes / hvscDownloadTotalBytes) * 100)
      : hvscStage === "download"
        ? hvscProgress
        : null;
  const hvscExtractionPercent =
    hvscSummaryFilesExtracted !== null && hvscExtractionTotalFiles
      ? Math.min(100, (hvscSummaryFilesExtracted / hvscExtractionTotalFiles) * 100)
      : hvscStage && HVSC_EXTRACTION_STAGES.has(hvscStage)
        ? hvscProgress
        : null;
  const hvscReadySongCount = hvscIngestionIngestedSongs || hvscIngestionTotalSongs;
  const hvscPreparationSnapshot: HvscPreparationSnapshot = useMemo(
    () =>
      resolveHvscPreparationSnapshot({
        available: hvscAvailable,
        installedVersion: hvscStatus?.installedVersion ?? 0,
        ingestionState: hvscStatus?.ingestionState ?? null,
        activeStage: hvscStage,
        downloadStatus: hvscStatusSummary.download.status,
        extractionStatus: hvscStatusSummary.extraction.status,
        metadataStatus: hvscStatusSummary.metadata.status,
        hasCachedArchive: hvscHasCache,
        inlineError: hvscInlineError,
        downloadErrorMessage: hvscStatusSummary.download.errorMessage ?? null,
        extractionErrorMessage: hvscStatusSummary.extraction.errorMessage ?? null,
        metadataErrorMessage: hvscStatusSummary.metadata.errorMessage ?? null,
        ingestionError: hvscStatus?.ingestionError ?? null,
        downloadFailureCategory: hvscStatusSummary.download.errorCategory ?? null,
        extractionFailureCategory: hvscStatusSummary.extraction.errorCategory ?? null,
      }),
    [
      hvscAvailable,
      hvscHasCache,
      hvscInlineError,
      hvscStage,
      hvscStatus?.ingestionError,
      hvscStatus?.ingestionState,
      hvscStatus?.installedVersion,
      hvscStatusSummary.download.errorCategory,
      hvscStatusSummary.download.errorMessage,
      hvscStatusSummary.download.status,
      hvscStatusSummary.extraction.errorCategory,
      hvscStatusSummary.extraction.errorMessage,
      hvscStatusSummary.extraction.status,
      hvscStatusSummary.metadata.errorMessage,
      hvscStatusSummary.metadata.status,
    ],
  );
  const hvscPreparationProgressPercent =
    hvscPreparationSnapshot.state === "DOWNLOADING"
      ? hvscDownloadPercent
      : hvscPreparationSnapshot.state === "INGESTING"
        ? hvscStatusSummary.metadata.status === "in-progress"
          ? (hvscStatusSummary.metadata.percent ?? hvscExtractionPercent)
          : hvscExtractionPercent
        : null;
  const hvscPreparationThroughputLabel = (() => {
    if (hvscPreparationSnapshot.state === "DOWNLOADING" && hvscDownloadBytes && hvscDownloadElapsedMs) {
      const mbPerSecond = hvscDownloadBytes / 1024 / 1024 / Math.max(hvscDownloadElapsedMs / 1000, 0.001);
      return `${mbPerSecond >= 10 ? mbPerSecond.toFixed(0) : mbPerSecond.toFixed(1)} MB/s`;
    }

    if (hvscPreparationSnapshot.state === "INGESTING") {
      const processedItems =
        hvscStatusSummary.metadata.status === "in-progress"
          ? hvscStatusSummary.metadata.processedSongs
          : hvscSummaryFilesExtracted;
      const elapsedMs =
        hvscStatusSummary.metadata.status === "in-progress"
          ? (hvscStatusSummary.metadata.durationMs ?? hvscExtractionElapsedMs)
          : hvscExtractionElapsedMs;
      if (processedItems && elapsedMs) {
        const itemsPerSecond = processedItems / Math.max(elapsedMs / 1000, 0.001);
        return `${Math.max(1, Math.round(itemsPerSecond)).toLocaleString()} items/s`;
      }
    }

    return null;
  })();

  const hvscVisibleFolders = useMemo(() => {
    if (!hvscFolderFilter) return hvscFolders;
    return hvscFolders.filter((folder) => folder.toLowerCase().includes(hvscFolderFilter.toLowerCase()));
  }, [hvscFolders, hvscFolderFilter]);

  const previousPreparationSnapshotRef = useRef<HvscPreparationSnapshot | null>(null);

  useEffect(() => {
    const previous = previousPreparationSnapshotRef.current;
    if (
      previous &&
      previous.state === hvscPreparationSnapshot.state &&
      previous.failedPhase === hvscPreparationSnapshot.failedPhase &&
      previous.errorReason === hvscPreparationSnapshot.errorReason
    ) {
      return;
    }

    addLog("info", "HVSC preparation state transition", {
      transition: describeHvscPreparationTransition(previous, hvscPreparationSnapshot),
      fromState: previous?.state ?? null,
      toState: hvscPreparationSnapshot.state,
      failedPhase: hvscPreparationSnapshot.failedPhase,
      reason: hvscPreparationSnapshot.errorReason,
    });
    previousPreparationSnapshotRef.current = hvscPreparationSnapshot;
  }, [hvscPreparationSnapshot]);

  useEffect(() => {
    if (!hvscInProgress) return;
    const timer = window.setInterval(() => setHvscElapsedNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hvscInProgress]);

  useEffect(() => {
    if (hvscStatusSummary.download.status === "in-progress") {
      setHvscActiveToken("hvsc-install");
    } else if (hvscStatusSummary.extraction.status === "in-progress") {
      setHvscActiveToken("hvsc-ingest");
    }
  }, [hvscStatusSummary.download.status, hvscStatusSummary.extraction.status]);

  const runHvscPreparation = useCallback(async () => {
    if (!hvscAvailable || hvscUpdating) {
      return;
    }

    if (hvscPreparationSnapshot.state === "READY") {
      return;
    }

    if (
      hvscPreparationSnapshot.state === "DOWNLOADED" ||
      (hvscPreparationSnapshot.state === "ERROR" && hvscPreparationSnapshot.failedPhase === "ingest")
    ) {
      await handleHvscIngest();
      return;
    }

    await handleHvscInstall();
  }, [
    hvscAvailable,
    hvscPreparationSnapshot.failedPhase,
    hvscPreparationSnapshot.state,
    hvscUpdating,
    handleHvscIngest,
    handleHvscInstall,
  ]);

  const retryHvscPreparation = useCallback(async () => {
    await runHvscPreparation();
  }, [runHvscPreparation]);

  return {
    hvscStatus,
    hvscPreparationState: hvscPreparationSnapshot.state,
    hvscPreparationPhase: hvscPreparationSnapshot.phase,
    hvscPreparationStatusLabel: hvscPreparationSnapshot.statusLabel,
    hvscPreparationErrorReason: hvscPreparationSnapshot.errorReason,
    hvscPreparationFailedPhase: hvscPreparationSnapshot.failedPhase,
    hvscPreparationProgressPercent,
    hvscPreparationThroughputLabel,
    hvscReadySongCount,
    hvscStatusSummary,
    hvscRoot,
    hvscAvailable,
    hvscLibraryAvailable,
    hvscCanIngest,
    hvscPhase,
    hvscFolderFilter,
    hvscFolders,
    hvscSongs,
    selectedHvscFolder,
    setHvscFolderFilter,
    loadHvscFolder,
    handleHvscInstall,
    handleHvscIngest,
    handleHvscCancel,
    handleHvscReset,
    handleHvscReindex,
    runHvscPreparation,
    retryHvscPreparation,
    buildHvscLocalPlayFile,
    formatHvscDuration,
    formatHvscTimestamp,
    hvscInstalled,
    hvscInProgress,
    hvscUpdating,
    hvscInlineError,
    hvscSummaryState,
    hvscSummaryFilesExtracted,
    hvscSummaryDurationMs,
    hvscSummaryUpdatedAt,
    hvscSummaryFailureLabel,
    hvscMetadataProgressLabel,
    hvscMetadataUpdatedAt,
    hvscIngestionTotalSongs,
    hvscIngestionIngestedSongs,
    hvscIngestionFailedSongs,
    hvscSonglengthSyntaxErrors,
    hvscDownloadPercent,
    hvscDownloadBytes,
    hvscDownloadTotalBytes,
    hvscDownloadElapsedMs,
    hvscDownloadStatus: hvscStatusSummary.download.status,
    hvscExtractionPercent,
    hvscExtractionTotalFiles,
    hvscExtractionElapsedMs,
    hvscExtractionStatus: hvscStatusSummary.extraction.status,
    hvscCurrentFile,
    hvscActionLabel,
    hvscStage,
    hvscVisibleFolders,
  };
};
