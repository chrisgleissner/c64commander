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
const IDLE_CONFIG_SNAPSHOT_DELAY_MS = 5000;

type WritableConfigPayload = Record<string, Record<string, string | number>>;

type FetchAllConfigMode = "user" | "background";

type FetchAllConfigOptions = {
  mode?: FetchAllConfigMode;
  signal?: AbortSignal;
};

type ConfigRevertMismatch = {
  category: string;
  item: string;
  expected: string | number;
  actual: string | number | null;
};

export type ConfigRevertResult =
  | { status: "missing-snapshot" }
  | {
      status: "reverted";
      // HARD19-024: categories that could not be re-read for verification (revert
      // still succeeded — these are unverified, NOT mismatched).
      unverifiedCategories?: string[];
      // HARD19-023: the baseline snapshot itself was captured incompletely, so
      // items in its missing categories were never written back.
      baselineIncomplete?: boolean;
    }
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

const createAbortError = (message: string) => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError("Config snapshot capture was cancelled.");
  }
};

const isAbortError = (error: unknown) => error instanceof Error && error.name === "AbortError";

const isDocumentHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

const collectConfigRevertMismatches = (
  expected: WritableConfigPayload,
  actual: WritableConfigPayload,
  unreadCategories: ReadonlySet<string> = new Set(),
): ConfigRevertMismatch[] => {
  const mismatches: ConfigRevertMismatch[] = [];

  for (const [category, expectedItems] of Object.entries(expected)) {
    // HARD19-024: a category that could not be re-read during verification is
    // UNVERIFIED, not mismatched. Counting its items as failures invents N false
    // mismatches for a revert that actually succeeded (the verification read just
    // timed out on a device still settling from the batch write).
    if (unreadCategories.has(category)) continue;
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

const fetchAllConfig = async ({ mode = "user", signal }: FetchAllConfigOptions = {}) => {
  const api = getC64API();
  const requestOptions = { __c64uIntent: mode, signal } as const;
  throwIfAborted(signal);
  const cats = await api.getCategories(requestOptions);
  const configs: Record<string, ConfigResponse> = {};
  const failedCategories: string[] = [];
  const readCategorySnapshot = async (category: string) => {
    throwIfAborted(signal);
    // Every caller of fetchAllConfig (initial snapshot capture, Save-to-App,
    // revert verification) needs a ground-truth device read, not the
    // localStorage-persisted, no-TTL enrichment cache: settings changed via
    // the C64U's own menu since the cache was last populated would make the
    // revert baseline wrong and actively write stale values back to the
    // device, and revert verification would compare updateConfigBatch's own
    // optimistic writes against themselves and always pass. See HARD9-018.
    return api.getCategory(category, requestOptions);
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

  throwIfAborted(signal);

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

  // HARD19-023/024: surface which categories could not be read so consumers can
  // (a) mark a snapshot provisional and retry (capture), (b) warn on save, and
  // (c) classify unread categories as "unverified" rather than "mismatched" on
  // revert — instead of silently accepting a partial snapshot.
  return { configs, failedCategories: unresolvedFailures };
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
  const idleCaptureAbortControllerRef = useRef<AbortController | null>(null);

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
    // HARD19-023: only a COMPLETE baseline short-circuits; a provisional one
    // (some categories unreadable at capture time) is re-attempted so the revert
    // baseline is not frozen incomplete for the life of the install.
    if (initialSnapshot && !initialSnapshot.failedCategories?.length) {
      return initialSnapshot;
    }
    if (captureInFlightRef.current) {
      return initialSnapshot;
    }

    captureInFlightRef.current = true;
    setSnapshotLoading(true);
    try {
      const { configs, failedCategories } = await fetchAllConfig({ mode: "user" });
      const snapshot: ConfigSnapshot = {
        savedAt: new Date().toISOString(),
        data: configs,
        ...(failedCategories.length ? { failedCategories } : {}),
      };
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

  const captureIdleInitialSnapshot = useCallback(
    async (signal: AbortSignal): Promise<ConfigSnapshot | null> => {
      if (
        !status.isConnected ||
        // HARD19-023: a provisional snapshot (has failedCategories) is re-captured
        // on later idle windows until complete; only a complete one blocks re-capture.
        (initialSnapshot && !initialSnapshot.failedCategories?.length) ||
        captureInFlightRef.current ||
        signal.aborted ||
        isDocumentHidden()
      ) {
        return initialSnapshot;
      }

      captureInFlightRef.current = true;
      setSnapshotLoading(true);
      try {
        const { configs, failedCategories } = await fetchAllConfig({ mode: "background", signal });
        if (signal.aborted || isDocumentHidden()) {
          throw createAbortError("Config snapshot capture was cancelled after the app left the foreground.");
        }
        const snapshot: ConfigSnapshot = {
          savedAt: new Date().toISOString(),
          data: configs,
          ...(failedCategories.length ? { failedCategories } : {}),
        };
        saveInitialSnapshot(resolvedBaseUrl, snapshot);
        setInitialSnapshot(snapshot);
        setFetchError(null);
        updateHasChanges(resolvedBaseUrl, false);
        return snapshot;
      } catch (error) {
        if (isAbortError(error)) {
          addLog("debug", "Idle config snapshot capture cancelled", {
            baseUrl: resolvedBaseUrl,
            reason: signal.aborted ? "abort-signal" : "hidden",
          });
          return null;
        }
        const message = (error as Error).message ?? "Unknown error";
        addErrorLog("Idle config snapshot capture failed", {
          error: message,
          baseUrl: resolvedBaseUrl,
        });
        setFetchError(message);
        return null;
      } finally {
        captureInFlightRef.current = false;
        idleCaptureAbortControllerRef.current = null;
        setSnapshotLoading(false);
      }
    },
    [initialSnapshot, resolvedBaseUrl, status.isConnected],
  );

  useEffect(() => {
    if (!status.isConnected) {
      if (idleCaptureTimeoutRef.current !== null) {
        clearTimeout(idleCaptureTimeoutRef.current);
        idleCaptureTimeoutRef.current = null;
      }
      idleCaptureAbortControllerRef.current?.abort();
      idleCaptureAbortControllerRef.current = null;
      captureInFlightRef.current = false;
      setSnapshotLoading(false);
      return;
    }
    if (initialSnapshot || captureInFlightRef.current) {
      return;
    }

    let cancelled = false;
    const cancelIdleCapture = (reason: string) => {
      if (idleCaptureTimeoutRef.current !== null) {
        clearTimeout(idleCaptureTimeoutRef.current);
        idleCaptureTimeoutRef.current = null;
      }
      if (idleCaptureAbortControllerRef.current) {
        idleCaptureAbortControllerRef.current.abort();
        idleCaptureAbortControllerRef.current = null;
      }
      addLog("debug", "Idle config snapshot deferred", {
        baseUrl: resolvedBaseUrl,
        reason,
      });
    };
    const scheduleIdleCapture = () => {
      if (cancelled || initialSnapshot || isDocumentHidden()) {
        return;
      }
      idleCaptureTimeoutRef.current = globalThis.setTimeout(() => {
        if (cancelled) {
          return;
        }
        if (isDocumentHidden()) {
          cancelIdleCapture("hidden");
          return;
        }
        const api = getC64API();
        if (api.getInFlightReadRequestCount() > 0 || pollingPauseRegistry.isPollingPaused()) {
          scheduleIdleCapture();
          return;
        }
        const controller = new AbortController();
        idleCaptureAbortControllerRef.current = controller;
        void captureIdleInitialSnapshot(controller.signal);
      }, IDLE_CONFIG_SNAPSHOT_DELAY_MS);
    };
    const handleVisibilityChange = () => {
      if (isDocumentHidden()) {
        cancelIdleCapture("hidden");
        return;
      }
      if (!cancelled && !initialSnapshot && !captureInFlightRef.current) {
        scheduleIdleCapture();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleIdleCapture();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (idleCaptureTimeoutRef.current !== null) {
        clearTimeout(idleCaptureTimeoutRef.current);
        idleCaptureTimeoutRef.current = null;
      }
      idleCaptureAbortControllerRef.current?.abort();
      idleCaptureAbortControllerRef.current = null;
    };
  }, [captureIdleInitialSnapshot, initialSnapshot, resolvedBaseUrl, status.isConnected]);

  const applyConfigData = useCallback(
    async (data: Record<string, ConfigResponse>) => {
      const api = getC64API();
      const payload = buildWritableConfigPayload(data);

      await api.updateConfigBatch(payload);

      queryClient.invalidateQueries({ queryKey: ["c64-category"] });
      queryClient.invalidateQueries({ queryKey: ["c64-all-config"] });
      // Home's quick-config controls (Turbo, Video Mode, RAM Expansion, SID
      // cards, lighting) read exclusively through c64-config-items/
      // c64-config-item, not c64-category/c64-all-config - without this,
      // Load From App / Revert / Load From Flash all keep showing pre-load
      // values on Home until the 30s staleTime lapses. See HARD9-017.
      queryClient.invalidateQueries({ queryKey: ["c64-config-items"] });
      queryClient.invalidateQueries({ queryKey: ["c64-config-item"] });
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
      const { configs: currentConfig, failedCategories } = await fetchAllConfig({ mode: "user" });
      // HARD19-024: exclude categories that couldn't be re-read from the mismatch
      // scan so an unreadable category is not reported as N failed settings.
      const unreadCategories = new Set(failedCategories);
      const mismatches = collectConfigRevertMismatches(
        expectedPayload,
        buildWritableConfigPayload(currentConfig),
        unreadCategories,
      );

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
      // HARD19-023/024: report the revert as succeeded, but flag categories that
      // could not be re-read (unverified) or that were never in the baseline
      // (baselineIncomplete — those items were not written back).
      return {
        status: "reverted",
        ...(unreadCategories.size ? { unverifiedCategories: [...unreadCategories] } : {}),
        ...(initialSnapshot.failedCategories?.length ? { baselineIncomplete: true } : {}),
      };
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
        const { configs, failedCategories } = await fetchAllConfig({ mode: "user" });
        const entry = createAppConfigEntry(resolvedBaseUrl, name, configs);
        const next = [entry, ...loadAppConfigs().filter((cfg) => cfg.id !== entry.id)];
        saveAppConfigs(next);
        setAppConfigs(listAppConfigs(resolvedBaseUrl));
        // HARD19-023: surface incompleteness so Save-to-App can warn instead of
        // claiming the full device setup was saved when categories were unreadable.
        return { entry, failedCategories };
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
