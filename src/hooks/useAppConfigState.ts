/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getC64API, ConfigResponse, getDefaultBaseUrl } from "@/lib/c64api";
import {
  AppConfigEntry,
  ConfigSnapshot,
  createAppConfigEntry,
  listAppConfigs,
  loadHasChanges,
  loadInitialSnapshot,
  saveAppConfigs,
  saveInitialSnapshot,
  updateHasChanges,
  loadAppConfigs,
} from "@/lib/config/appConfigStore";
import { useC64Connection } from "@/hooks/useC64Connection";
import { addErrorLog, addLog } from "@/lib/logging";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";

const FULL_CONFIG_BACKGROUND_CONCURRENCY = 4;

type WritableConfigPayload = Record<string, Record<string, string | number>>;

type ConfigRevertMismatch = {
  category: string;
  item: string;
  expected: string | number;
  actual: string | number | null;
};

export type ConfigRevertResult =
  | { status: "missing-snapshot" }
  | { status: "reverted" }
  | {
      status: "verification-failed";
      message: string;
      mismatchCount: number;
      mismatches: ConfigRevertMismatch[];
    };

const isReadOnlyItem = (name: string) => name.startsWith("SID Detected Socket");

const extractItems = (categoryName: string, response: ConfigResponse) => {
  const responseRecord = response as Record<string, unknown>;
  const categoryBlock = (responseRecord[categoryName] ?? response) as Record<string, unknown> | null;
  const itemsBlock = (categoryBlock as Record<string, unknown> | null)?.items ?? categoryBlock;

  if (!itemsBlock || typeof itemsBlock !== "object") return [] as Array<{ name: string; value: string | number }>;

  return Object.entries(itemsBlock)
    .filter(([key]) => key !== "errors")
    .map(([name, config]) => ({ name, value: extractConfigValue(config) }));
};

const buildWritableConfigPayload = (data: Record<string, ConfigResponse>): WritableConfigPayload => {
  const payload: WritableConfigPayload = {};

  for (const [categoryName, response] of Object.entries(data)) {
    const items = extractItems(categoryName, response);
    if (!items.length) continue;

    const categoryPayload: Record<string, string | number> = {};
    for (const item of items) {
      if (isReadOnlyItem(item.name)) continue;
      categoryPayload[item.name] = item.value;
    }

    if (Object.keys(categoryPayload).length > 0) {
      payload[categoryName] = categoryPayload;
    }
  }

  return payload;
};

const valuesMatch = (expected: string | number, actual: string | number | null) =>
  actual !== null && (expected === actual || String(expected) === String(actual));

const collectConfigRevertMismatches = (
  expected: WritableConfigPayload,
  actual: WritableConfigPayload,
): ConfigRevertMismatch[] => {
  const mismatches: ConfigRevertMismatch[] = [];

  for (const [category, expectedItems] of Object.entries(expected)) {
    const actualItems = actual[category] ?? {};
    for (const [item, expectedValue] of Object.entries(expectedItems)) {
      const actualValue = Object.prototype.hasOwnProperty.call(actualItems, item) ? (actualItems[item] ?? null) : null;
      if (!valuesMatch(expectedValue, actualValue)) {
        mismatches.push({
          category,
          item,
          expected: expectedValue,
          actual: actualValue,
        });
      }
    }
  }

  return mismatches;
};

const fetchAllConfig = async () => {
  const api = getC64API();
  const cats = await api.getCategories();
  const configs: Record<string, ConfigResponse> = {};
  const failedCategories: string[] = [];
  const readCategorySnapshot = async (category: string) => {
    const cached = api.getCachedCategory(category);
    if (cached) {
      return cached;
    }
    return api.getCategory(category);
  };

  for (let index = 0; index < cats.categories.length; index += FULL_CONFIG_BACKGROUND_CONCURRENCY) {
    const batch = cats.categories.slice(index, index + FULL_CONFIG_BACKGROUND_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (category) => ({
        category,
        response: await readCategorySnapshot(category),
      })),
    );

    results.forEach((result, resultIndex) => {
      const category = batch[resultIndex];
      if (result.status === "fulfilled") {
        configs[category] = result.value.response;
        return;
      }

      addLog("debug", "Config category fetch failed; will retry individually", {
        category,
        error: (result.reason as Error).message,
      });
      failedCategories.push(category);
    });
  }

  for (const category of failedCategories) {
    try {
      configs[category] = await readCategorySnapshot(category);
    } catch (catError) {
      addLog("debug", "Config category retry failed; category omitted from snapshot", {
        category,
        error: (catError as Error).message,
      });
    }
  }

  const unresolvedFailures = failedCategories.filter(
    (category) => !Object.prototype.hasOwnProperty.call(configs, category),
  );
  const hasFailures = unresolvedFailures.length > 0;
  const hasSuccesses = Object.keys(configs).length > 0;

  if (hasFailures && hasSuccesses) {
    // Partial failure: some categories loaded — log a summary so operators
    // can diagnose incomplete config snapshots without noisy per-category spam.
    addLog(
      "debug",
      `Config fetch partially failed: ${unresolvedFailures.join(", ")} unavailable (using partial snapshot)`,
      { failedCategories: unresolvedFailures },
    );
  } else if (hasFailures && !hasSuccesses) {
    throw new Error(`Failed to fetch configuration categories: ${unresolvedFailures.join(", ")}`);
  }

  return configs;
};

export function useAppConfigState() {
  const { status, baseUrl } = useC64Connection();
  const queryClient = useQueryClient();
  const resolvedBaseUrl = baseUrl || getDefaultBaseUrl();

  const [initialSnapshot, setInitialSnapshot] = useState<ConfigSnapshot | null>(() =>
    loadInitialSnapshot(resolvedBaseUrl),
  );
  const [hasChanges, setHasChanges] = useState(() => loadHasChanges(resolvedBaseUrl));
  const [appConfigs, setAppConfigs] = useState<AppConfigEntry[]>(() => listAppConfigs(resolvedBaseUrl));
  const [isSnapshotLoading, setSnapshotLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const captureInFlightRef = useRef(false);
  const idleCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInitialSnapshot(loadInitialSnapshot(resolvedBaseUrl));
    setHasChanges(loadHasChanges(resolvedBaseUrl));
    setAppConfigs(listAppConfigs(resolvedBaseUrl));
  }, [resolvedBaseUrl]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { baseUrl?: string; value?: boolean } | undefined;
      if (!detail || detail.baseUrl !== resolvedBaseUrl) return;
      if (typeof detail.value === "boolean") {
        setHasChanges(detail.value);
      }
    };

    window.addEventListener("c64u-has-changes", handler as EventListener);
    return () => window.removeEventListener("c64u-has-changes", handler as EventListener);
  }, [resolvedBaseUrl]);

  const captureInitialSnapshot = useCallback(async (): Promise<ConfigSnapshot | null> => {
    if (!status.isConnected) {
      return null;
    }
    if (initialSnapshot) {
      return initialSnapshot;
    }
    if (captureInFlightRef.current) {
      return initialSnapshot;
    }

    captureInFlightRef.current = true;
    setSnapshotLoading(true);
    try {
      const data = await fetchAllConfig();
      const snapshot = { savedAt: new Date().toISOString(), data };
      saveInitialSnapshot(resolvedBaseUrl, snapshot);
      setInitialSnapshot(snapshot);
      setFetchError(null);
      updateHasChanges(resolvedBaseUrl, false);
      return snapshot;
    } catch (error) {
      const message = (error as Error).message ?? "Unknown error";
      addErrorLog("Initial config snapshot capture failed", {
        error: message,
        baseUrl: resolvedBaseUrl,
      });
      setFetchError(message);
      return null;
    } finally {
      captureInFlightRef.current = false;
      setSnapshotLoading(false);
    }
  }, [initialSnapshot, resolvedBaseUrl, status.isConnected]);

  useEffect(() => {
    if (!status.isConnected) {
      if (idleCaptureTimeoutRef.current !== null) {
        clearTimeout(idleCaptureTimeoutRef.current);
        idleCaptureTimeoutRef.current = null;
      }
      captureInFlightRef.current = false;
      setSnapshotLoading(false);
      return;
    }
    if (initialSnapshot || captureInFlightRef.current) {
      return;
    }

    let cancelled = false;
    const scheduleIdleCapture = () => {
      idleCaptureTimeoutRef.current = globalThis.setTimeout(() => {
        if (cancelled) {
          return;
        }
        const api = getC64API();
        if (api.getInFlightReadRequestCount() > 0 || pollingPauseRegistry.isPollingPaused()) {
          scheduleIdleCapture();
          return;
        }
        void captureInitialSnapshot();
      }, 5000);
    };

    scheduleIdleCapture();

    return () => {
      cancelled = true;
      if (idleCaptureTimeoutRef.current !== null) {
        clearTimeout(idleCaptureTimeoutRef.current);
        idleCaptureTimeoutRef.current = null;
      }
    };
  }, [captureInitialSnapshot, initialSnapshot, status.isConnected]);

  const applyConfigData = useCallback(
    async (data: Record<string, ConfigResponse>) => {
      const api = getC64API();
      const payload = buildWritableConfigPayload(data);

      await api.updateConfigBatch(payload);

      queryClient.invalidateQueries({ queryKey: ["c64-category"] });
      queryClient.invalidateQueries({ queryKey: ["c64-all-config"] });
    },
    [queryClient],
  );

  const revertToInitial = useCallback(async (): Promise<ConfigRevertResult> => {
    if (!initialSnapshot) {
      return { status: "missing-snapshot" };
    }

    setIsApplying(true);
    try {
      await applyConfigData(initialSnapshot.data);
      const expectedPayload = buildWritableConfigPayload(initialSnapshot.data);
      const currentConfig = await fetchAllConfig();
      const mismatches = collectConfigRevertMismatches(expectedPayload, buildWritableConfigPayload(currentConfig));

      if (mismatches.length > 0) {
        addLog("warn", "Config revert verification failed", {
          baseUrl: resolvedBaseUrl,
          mismatchCount: mismatches.length,
          mismatches: mismatches.slice(0, 5),
        });

        return {
          status: "verification-failed",
          message:
            mismatches.length === 1
              ? "Revert applied, but 1 setting did not match the initial snapshot."
              : `Revert applied, but ${mismatches.length} settings did not match the initial snapshot.`,
          mismatchCount: mismatches.length,
          mismatches,
        };
      }

      updateHasChanges(resolvedBaseUrl, false);
      return { status: "reverted" };
    } finally {
      setIsApplying(false);
    }
  }, [applyConfigData, initialSnapshot, resolvedBaseUrl]);

  const saveCurrentConfig = useCallback(
    async (name: string) => {
      setIsSaving(true);
      try {
        if (!initialSnapshot) {
          await captureInitialSnapshot();
        }
        const data = await fetchAllConfig();
        const entry = createAppConfigEntry(resolvedBaseUrl, name, data);
        const next = [entry, ...loadAppConfigs().filter((cfg) => cfg.id !== entry.id)];
        saveAppConfigs(next);
        setAppConfigs(listAppConfigs(resolvedBaseUrl));
        return entry;
      } finally {
        setIsSaving(false);
      }
    },
    [captureInitialSnapshot, initialSnapshot, resolvedBaseUrl],
  );

  const loadAppConfig = useCallback(
    async (entry: AppConfigEntry) => {
      setIsApplying(true);
      try {
        await applyConfigData(entry.data);
        updateHasChanges(resolvedBaseUrl, true);
      } finally {
        setIsApplying(false);
      }
    },
    [applyConfigData, resolvedBaseUrl],
  );

  const renameAppConfig = useCallback(
    (entryId: string, name: string) => {
      const allConfigs = loadAppConfigs();
      const next = allConfigs.map((entry) => (entry.id === entryId ? { ...entry, name } : entry));
      saveAppConfigs(next);
      setAppConfigs(listAppConfigs(resolvedBaseUrl));
    },
    [resolvedBaseUrl],
  );

  const deleteAppConfig = useCallback(
    (entryId: string) => {
      const allConfigs = loadAppConfigs();
      const next = allConfigs.filter((entry) => entry.id !== entryId);
      saveAppConfigs(next);
      setAppConfigs(listAppConfigs(resolvedBaseUrl));
    },
    [resolvedBaseUrl],
  );

  const markChanged = useCallback(() => updateHasChanges(resolvedBaseUrl, true), [resolvedBaseUrl]);
  const clearChanges = useCallback(() => updateHasChanges(resolvedBaseUrl, false), [resolvedBaseUrl]);

  return {
    initialSnapshot,
    isSnapshotLoading,
    fetchError,
    hasChanges,
    isApplying,
    isSaving,
    appConfigs,
    markChanged,
    clearChanges,
    captureInitialSnapshot,
    revertToInitial,
    saveCurrentConfig,
    loadAppConfig,
    renameAppConfig,
    deleteAppConfig,
  };
}
