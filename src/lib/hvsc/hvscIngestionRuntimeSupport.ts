/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import type { HvscIngestionState, HvscProgressEvent } from "./hvscTypes";
import { loadHvscState, updateHvscState } from "./hvscStateStore";
import { loadHvscStatusSummary, saveHvscStatusSummary } from "./hvscStatusStore";

export type HvscProgressListenerHandle = {
  remove: () => Promise<void>;
};

type HvscIngestionRuntimeState = {
  cancelTokens: Map<string, { cancelled: boolean }>;
  activeIngestionRunning: boolean;
  nativeListenersByToken: Map<string, Set<HvscProgressListenerHandle>>;
  cacheStatFailures: Map<string, number>;
};

const runtimeState: HvscIngestionRuntimeState = {
  cancelTokens: new Map<string, { cancelled: boolean }>(),
  activeIngestionRunning: false,
  nativeListenersByToken: new Map<string, Set<HvscProgressListenerHandle>>(),
  cacheStatFailures: new Map<string, number>(),
};

const CACHE_STAT_FAILURE_ESCALATION_THRESHOLD = 2;

export const getHvscIngestionRuntimeState = () => runtimeState;

export const registerNativeProgressListener = (token: string, listener: HvscProgressListenerHandle) => {
  const listeners = runtimeState.nativeListenersByToken.get(token) ?? new Set<HvscProgressListenerHandle>();
  listeners.add(listener);
  runtimeState.nativeListenersByToken.set(token, listeners);
};

export const removeNativeProgressListener = async (token: string, listener: HvscProgressListenerHandle) => {
  const listeners = runtimeState.nativeListenersByToken.get(token);
  try {
    await listener.remove();
  } catch (error) {
    addLog("warn", "Failed to remove HVSC native progress listener", {
      token,
      error: (error as Error).message,
    });
  } finally {
    if (!listeners) {
      runtimeState.nativeListenersByToken.delete(token);
    } else {
      listeners.delete(listener);
      if (listeners.size === 0) {
        runtimeState.nativeListenersByToken.delete(token);
      }
    }
  }
};

export const drainNativeProgressListeners = async (token?: string) => {
  const tokens = token ? [token] : Array.from(runtimeState.nativeListenersByToken.keys());
  for (const itemToken of tokens) {
    const listeners = runtimeState.nativeListenersByToken.get(itemToken);
    if (!listeners?.size) {
      runtimeState.nativeListenersByToken.delete(itemToken);
      continue;
    }
    for (const listener of Array.from(listeners)) {
      await removeNativeProgressListener(itemToken, listener);
    }
  }
};

export const resetCacheStatFailure = (archiveName: string) => {
  runtimeState.cacheStatFailures.delete(archiveName);
};

export const reportCacheStatFailure = (
  archiveName: string,
  error: unknown,
  emitProgress?: (event: Omit<HvscProgressEvent, "ingestionId" | "elapsedTimeMs">) => void,
) => {
  const failures = (runtimeState.cacheStatFailures.get(archiveName) ?? 0) + 1;
  runtimeState.cacheStatFailures.set(archiveName, failures);
  const errorMessage = (error as Error).message;
  addLog("warn", "HVSC cached archive stat failed", {
    archiveName,
    error: errorMessage,
    failureCount: failures,
  });
  if (failures >= CACHE_STAT_FAILURE_ESCALATION_THRESHOLD) {
    addErrorLog("HVSC cache health degraded", {
      archiveName,
      failureCount: failures,
      remediation: "Re-download the archive from settings and retry ingestion.",
      error: {
        name: (error as Error).name,
        message: errorMessage,
        stack: (error as Error).stack,
      },
    });
    emitProgress?.({
      stage: "warning",
      message: `Cache metadata check failed for ${archiveName}; re-download archive recommended`,
      archiveName,
      errorCause: errorMessage,
    });
  }
};

export const formatPathListPreview = (paths: string[]) => {
  if (!paths.length) return "none";
  const previewLimit = 10;
  const preview = paths.slice(0, previewLimit).join(", ");
  return paths.length > previewLimit ? `${preview} (+${paths.length - previewLimit} more)` : preview;
};

export const applyCancelledIngestionState = (
  message = "Cancelled",
  emitProgress?: (event: Omit<HvscProgressEvent, "ingestionId" | "elapsedTimeMs">) => void,
  archiveName?: string,
) => {
  updateHvscState({ ingestionState: "idle", ingestionError: message });
  const summary = loadHvscStatusSummary();
  const now = new Date().toISOString();
  saveHvscStatusSummary({
    ...summary,
    download:
      summary.download.status === "in-progress"
        ? {
            ...summary.download,
            status: "idle",
            archiveName: archiveName ?? summary.download.archiveName ?? null,
            lastStage: "cancelled",
            finishedAt: now,
            errorCategory: null,
            errorMessage: message,
            recoveryHint: "Retry the HVSC install or ingest to restart from the last complete archive state.",
          }
        : summary.download,
    extraction:
      summary.extraction.status === "in-progress"
        ? {
            ...summary.extraction,
            status: "idle",
            archiveName: archiveName ?? summary.extraction.archiveName ?? summary.download.archiveName ?? null,
            lastStage: "cancelled",
            finishedAt: now,
            errorCategory: null,
            errorMessage: message,
            recoveryHint: "Retry the HVSC install or ingest to restart from the last complete archive state.",
          }
        : summary.extraction,
    lastUpdatedAt: now,
  });
  emitProgress?.({
    stage: "cancelled",
    message,
    archiveName,
    errorCause: message,
  });
};

export const isIngestionRuntimeActive = () => runtimeState.activeIngestionRunning;

export const recoverStaleIngestionState = (): boolean => {
  if (runtimeState.activeIngestionRunning) return false;
  const state = loadHvscState();
  if (state.ingestionState !== "installing" && state.ingestionState !== "updating") return false;
  addLog("warn", "HVSC cold-start recovery: resetting stale ingestion state", {
    ingestionState: state.ingestionState,
  });
  updateHvscState({
    ingestionState: "error" as HvscIngestionState,
    ingestionError: "Interrupted by app restart",
  });
  const summary = loadHvscStatusSummary();
  const now = new Date().toISOString();
  if (summary.download.status === "in-progress" || summary.extraction.status === "in-progress") {
    saveHvscStatusSummary({
      ...summary,
      download:
        summary.download.status === "in-progress"
          ? {
              ...summary.download,
              status: "failure",
              lastStage: "recovered-interrupted",
              finishedAt: now,
              errorMessage: "Interrupted by app restart",
              errorCategory: "unknown",
              recoveryHint: "Retry the HVSC install or ingest. Partial progress was not promoted to ready state.",
            }
          : summary.download,
      extraction:
        summary.extraction.status === "in-progress"
          ? {
              ...summary.extraction,
              status: "failure",
              lastStage: "recovered-interrupted",
              finishedAt: now,
              errorMessage: "Interrupted by app restart",
              errorCategory: "unknown",
              recoveryHint: "Retry the HVSC install or ingest. Partial progress was not promoted to ready state.",
            }
          : summary.extraction,
      lastUpdatedAt: now,
    });
  }
  return true;
};
