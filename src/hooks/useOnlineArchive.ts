/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createArchiveClient } from "@/lib/archive/client";
import { executeArchiveEntry } from "@/lib/archive/execution";
import { resolveArchiveClientConfig } from "@/lib/archive/config";
import type {
  ArchiveClientConfigInput,
  ArchiveClientResolvedConfig,
  ArchiveEntry,
  ArchivePreset,
  ArchivePresetType,
  ArchiveSearchParams,
  ArchiveSearchResult,
} from "@/lib/archive/types";

const PRESET_TYPE_ORDER: ArchivePresetType[] = ["category", "date", "type", "sort", "order"];
const DEFAULT_DATE_START_YEAR = 1980;

const buildYearPresetValues = (endYear: number) =>
  Array.from({ length: Math.max(0, endYear - DEFAULT_DATE_START_YEAR + 1) }, (_, index) => {
    const year = String(DEFAULT_DATE_START_YEAR + index);
    return { aqlKey: year, name: year };
  });

const buildSeededPresets = (currentYear: number): ArchivePreset[] => [
  {
    type: "category",
    description: "Category",
    values: [
      { aqlKey: "apps", name: "Apps" },
      { aqlKey: "demos", name: "Demos" },
      { aqlKey: "games", name: "Games" },
      { aqlKey: "graphics", name: "Graphics" },
      { aqlKey: "music", name: "Music" },
    ],
  },
  {
    type: "date",
    description: "Date",
    values: buildYearPresetValues(currentYear),
  },
  {
    type: "type",
    description: "Type",
    values: [
      { aqlKey: "crt", name: "crt" },
      { aqlKey: "d64", name: "d64" },
      { aqlKey: "d71", name: "d71" },
      { aqlKey: "d81", name: "d81" },
      { aqlKey: "sid", name: "sid" },
      { aqlKey: "t64", name: "t64" },
      { aqlKey: "tap", name: "tap" },
    ],
  },
  {
    type: "sort",
    description: "Sort by",
    values: [
      { aqlKey: "name", name: "Name" },
      { aqlKey: "year", name: "Year" },
    ],
  },
  {
    type: "order",
    description: "Sort Order",
    values: [
      { aqlKey: "asc", name: "Ascending" },
      { aqlKey: "desc", name: "Descending" },
    ],
  },
];

const deriveDatePreset = (
  verifiedPreset: ArchivePreset | undefined,
  seededPreset: ArchivePreset,
  currentYear: number,
) => {
  const verifiedYears = (verifiedPreset?.values ?? [])
    .map((value) => Number.parseInt(value.aqlKey, 10))
    .filter((value) => Number.isFinite(value));
  const maxVerifiedYear = verifiedYears.length ? Math.max(...verifiedYears) : DEFAULT_DATE_START_YEAR;
  const endYear = Math.max(currentYear, maxVerifiedYear);
  return {
    type: "date" as const,
    description: verifiedPreset?.description ?? seededPreset.description,
    values: buildYearPresetValues(endYear),
  };
};

const normalizePreset = (
  verifiedPreset: ArchivePreset | undefined,
  seededPreset: ArchivePreset,
  currentYear: number,
) => {
  if (!verifiedPreset || verifiedPreset.values.length === 0) {
    return seededPreset;
  }

  if (verifiedPreset.type === "date") {
    return deriveDatePreset(verifiedPreset, seededPreset, currentYear);
  }

  return {
    ...verifiedPreset,
    values: verifiedPreset.values.map((value) => ({
      ...value,
      name: value.name ?? value.aqlKey,
    })),
  };
};

const normalizePresets = (verifiedPresets: ArchivePreset[], currentYear: number) => {
  const seededPresets = buildSeededPresets(currentYear);
  const verifiedByType = new Map(verifiedPresets.map((preset) => [preset.type, preset]));
  return PRESET_TYPE_ORDER.map((type) =>
    normalizePreset(
      verifiedByType.get(type),
      seededPresets.find((preset) => preset.type === type) as ArchivePreset,
      currentYear,
    ),
  );
};

const presetCache = new Map<string, ArchivePreset[]>();
const presetRefreshStatus = new Map<string, "pending" | "settled">();
const presetRefreshPromises = new Map<string, Promise<ArchivePreset[]>>();

export const __resetArchivePresetCacheForTests = () => {
  presetCache.clear();
  presetRefreshStatus.clear();
  presetRefreshPromises.clear();
};

export type OnlineArchiveState =
  | { phase: "idle" }
  | { phase: "searching" }
  | { phase: "results"; params: ArchiveSearchParams; results: ArchiveSearchResult[] }
  | {
      phase: "loadingEntries";
      params: ArchiveSearchParams;
      result: ArchiveSearchResult;
      results: ArchiveSearchResult[];
    }
  | {
      phase: "entries";
      params: ArchiveSearchParams;
      result: ArchiveSearchResult;
      results: ArchiveSearchResult[];
      entries: ArchiveEntry[];
    }
  | {
      phase: "downloading";
      params: ArchiveSearchParams;
      result: ArchiveSearchResult;
      results: ArchiveSearchResult[];
      entry: ArchiveEntry;
      entries: ArchiveEntry[];
    }
  | {
      phase: "executing";
      params: ArchiveSearchParams;
      result: ArchiveSearchResult;
      results: ArchiveSearchResult[];
      entry: ArchiveEntry;
      entries: ArchiveEntry[];
    }
  | { phase: "error"; message: string; recoverableState: Exclude<OnlineArchiveState, { phase: "error" }> | null };

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export const useOnlineArchive = (config: ArchiveClientConfigInput) => {
  const currentYear = new Date().getFullYear();
  const seededPresets = useMemo(() => buildSeededPresets(currentYear), [currentYear]);
  const configKey = JSON.stringify({
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    headers: config.headers ?? {},
    enabled: config.enabled ?? true,
  });
  const resolvedConfig = useMemo<ArchiveClientResolvedConfig>(() => resolveArchiveClientConfig(config), [configKey]);
  const client = useMemo(() => createArchiveClient(config), [configKey]);
  const [presets, setPresets] = useState<ArchivePreset[]>(() => presetCache.get(configKey) ?? seededPresets);
  const [presetsLoading, setPresetsLoading] = useState(presetRefreshStatus.get(configKey) === "pending");
  const [state, setState] = useState<OnlineArchiveState>({ phase: "idle" });
  const requestVersionRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setState((current) => {
      if (current.phase === "error") {
        return current.recoverableState ?? { phase: "idle" };
      }
      if (current.phase === "loadingEntries") {
        return { phase: "results", params: current.params, results: current.results };
      }
      if (current.phase === "downloading" || current.phase === "executing") {
        return {
          phase: "entries",
          params: current.params,
          result: current.result,
          results: current.results,
          entries: current.entries,
        };
      }
      if (current.phase === "searching") {
        return { phase: "idle" };
      }
      return current;
    });
  }, []);

  useEffect(() => {
    setPresets(presetCache.get(configKey) ?? seededPresets);
    setPresetsLoading(presetRefreshStatus.get(configKey) === "pending");

    if (presetRefreshStatus.get(configKey) === "settled") {
      return undefined;
    }

    const controller = new AbortController();
    let refreshPromise = presetRefreshPromises.get(configKey);
    if (!refreshPromise) {
      presetRefreshStatus.set(configKey, "pending");
      refreshPromise = client
        .getPresets({ signal: controller.signal })
        .then((next) => {
          const normalized = normalizePresets(next, currentYear);
          presetCache.set(configKey, normalized);
          presetRefreshStatus.set(configKey, "settled");
          return normalized;
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            throw error;
          }
          presetCache.set(configKey, presetCache.get(configKey) ?? seededPresets);
          presetRefreshStatus.set(configKey, "settled");
          return presetCache.get(configKey) ?? seededPresets;
        })
        .finally(() => {
          presetRefreshPromises.delete(configKey);
        });
      presetRefreshPromises.set(configKey, refreshPromise);
    }

    setPresetsLoading(true);
    void refreshPromise
      .then((next) => {
        if (controller.signal.aborted) return;
        setPresets(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPresetsLoading(false);
        }
      });

    return () => controller.abort();
  }, [client, configKey, currentYear, seededPresets]);

  const runRequest = useCallback(
    async <T>(
      startState: OnlineArchiveState,
      onSuccess: (value: T) => OnlineArchiveState,
      request: (signal: AbortSignal) => Promise<T>,
      fallbackMessage: string,
    ) => {
      const version = requestVersionRef.current + 1;
      requestVersionRef.current = version;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const recoverableState = state.phase === "error" ? state.recoverableState : state;
      setState(startState);
      try {
        const value = await request(controller.signal);
        if (controller.signal.aborted || requestVersionRef.current !== version) return;
        setState(onSuccess(value));
      } catch (error) {
        if (controller.signal.aborted || requestVersionRef.current !== version) return;
        setState({
          phase: "error",
          message: toErrorMessage(error, fallbackMessage),
          recoverableState: recoverableState ?? null,
        });
      }
    },
    [state],
  );

  const search = useCallback(
    async (params: ArchiveSearchParams) => {
      await runRequest<ArchiveSearchResult[]>(
        { phase: "searching" },
        (results) => ({ phase: "results", params, results }),
        (signal) => client.search(params, { signal }),
        "Archive search failed.",
      );
    },
    [client, runRequest],
  );

  const openEntries = useCallback(
    async (params: ArchiveSearchParams, result: ArchiveSearchResult, results: ArchiveSearchResult[]) => {
      await runRequest<ArchiveEntry[]>(
        { phase: "loadingEntries", params, result, results },
        (entries) => ({ phase: "entries", params, result, results, entries }),
        (signal) => client.getEntries(result.id, result.category, { signal }),
        "Failed to load archive entries.",
      );
    },
    [client, runRequest],
  );

  const execute = useCallback(
    async (
      params: ArchiveSearchParams,
      result: ArchiveSearchResult,
      results: ArchiveSearchResult[],
      entry: ArchiveEntry,
      entries: ArchiveEntry[],
    ) => {
      const version = requestVersionRef.current + 1;
      requestVersionRef.current = version;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const recoverableState: OnlineArchiveState = { phase: "entries", params, result, results, entries };
      setState({ phase: "downloading", params, result, results, entry, entries });
      try {
        const binary = await client.downloadBinary(result.id, result.category, entry.id, entry.path, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestVersionRef.current !== version) return;
        setState({ phase: "executing", params, result, results, entry, entries });
        await executeArchiveEntry({ result, entry, binary });
        if (controller.signal.aborted || requestVersionRef.current !== version) return;
        setState(recoverableState);
      } catch (error) {
        if (controller.signal.aborted || requestVersionRef.current !== version) return;
        setState({
          phase: "error",
          message: toErrorMessage(error, "Archive execution failed."),
          recoverableState,
        });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [client],
  );

  return {
    client,
    clientType: client.constructor.name,
    resolvedConfig,
    presets,
    presetsLoading,
    state,
    cancel,
    search,
    openEntries,
    execute,
    clearError: () =>
      setState((current) => (current.phase === "error" ? (current.recoverableState ?? { phase: "idle" }) : current)),
  };
};
