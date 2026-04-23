/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureWithinRoot, getParentPathWithinRoot } from "./paths";
import { addErrorLog } from "@/lib/logging";
import type { SourceEntry, SourceLocation } from "./types";

const PAGE_SIZE = 200;

const sortEntriesByName = (entries: SourceEntry[]) =>
  [...entries].sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));

const mergeEntriesByPath = (existing: SourceEntry[], incoming: SourceEntry[]) => {
  const merged = new Map(existing.map((entry) => [entry.path, entry]));
  incoming.forEach((entry) => merged.set(entry.path, entry));
  return sortEntriesByName(Array.from(merged.values()));
};

export type SourceNavigatorState = {
  path: string;
  entries: SourceEntry[];
  isLoading: boolean;
  showLoadingIndicator: boolean;
  error: string | null;
  query?: string;
  setQuery?: (query: string) => void;
  hasMore?: boolean;
  loadMore?: () => void;
  totalCount?: number | null;
  isQueryBacked?: boolean;
  navigateTo: (path: string) => void;
  navigateUp: () => void;
  navigateRoot: () => void;
  refresh: () => void;
};

const buildNavKey = (source: SourceLocation) => `c64u_source_nav:${source.type}:${source.id}`;

const getStoredPath = (source: SourceLocation) => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(buildNavKey(source));
  return raw || null;
};

const setStoredPath = (source: SourceLocation, path: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(buildNavKey(source), path);
};

export const useSourceNavigator = (source: SourceLocation | null): SourceNavigatorState => {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQueryState] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const loadingTokenRef = useRef(0);
  const loadingShownAtRef = useRef<number | null>(null);
  const queryRef = useRef("");
  const isQueryBacked = Boolean(source?.listEntriesPage);

  const loadEntries = useCallback(
    async (nextPath: string, options?: { query?: string; offset?: number; append?: boolean }) => {
      if (!source) return;
      const token = loadingTokenRef.current + 1;
      loadingTokenRef.current = token;
      setIsLoading(true);
      setError(null);
      let loadingTimer: number | null = null;
      if (source.type === "ultimate") {
        loadingTimer = window.setTimeout(() => {
          if (loadingTokenRef.current === token) {
            loadingShownAtRef.current = Date.now();
            setShowLoadingIndicator(true);
          }
        }, 200);
      } else {
        setShowLoadingIndicator(false);
      }
      try {
        const safePath = ensureWithinRoot(nextPath, source.rootPath);
        const requestedQuery = options?.query ?? queryRef.current;
        if (loadingTokenRef.current !== token) return; // stale response — discard
        if (source.listEntriesPage) {
          const page = await source.listEntriesPage({
            path: safePath,
            query: requestedQuery,
            offset: options?.offset ?? 0,
            limit: PAGE_SIZE,
          });
          if (loadingTokenRef.current !== token) return;
          setEntries((currentEntries) =>
            options?.append ? mergeEntriesByPath(currentEntries, page.entries) : sortEntriesByName(page.entries),
          );
          setTotalCount(page.totalCount);
          setNextOffset(page.nextOffset);
        } else {
          const result = await source.listEntries(safePath);
          if (loadingTokenRef.current !== token) return;
          setEntries(sortEntriesByName(result));
          setTotalCount(result.length);
          setNextOffset(null);
        }
        setPath(safePath);
      } catch (err) {
        if (loadingTokenRef.current !== token) return;
        const error = err as Error;
        setError(error.message);
        addErrorLog("Source browse failed", {
          sourceId: source.id,
          sourceType: source.type,
          path: nextPath,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        });
      } finally {
        if (loadingTimer !== null) {
          window.clearTimeout(loadingTimer);
        }
        if (loadingTokenRef.current === token) {
          const shownAt = loadingShownAtRef.current;
          if (shownAt) {
            const elapsed = Date.now() - shownAt;
            const remaining = 300 - elapsed;
            if (remaining > 0) {
              window.setTimeout(() => {
                if (loadingTokenRef.current === token) {
                  setShowLoadingIndicator(false);
                  loadingShownAtRef.current = null;
                }
              }, remaining);
            } else {
              setShowLoadingIndicator(false);
              loadingShownAtRef.current = null;
            }
          } else {
            setShowLoadingIndicator(false);
          }
          setIsLoading(false);
        }
      }
    },
    [source],
  );

  useEffect(() => {
    if (!source) return;
    queryRef.current = "";
    setQueryState("");
    const stored = getStoredPath(source);
    const initialPath = stored ? ensureWithinRoot(stored, source.rootPath) : source.rootPath;
    void loadEntries(initialPath, { query: "" });
  }, [loadEntries, source]);

  useEffect(() => {
    if (!source) return;
    setStoredPath(source, path);
  }, [path, source]);

  const navigateTo = useCallback(
    (nextPath: string) => {
      if (!source) return;
      void loadEntries(nextPath, { query: queryRef.current });
    },
    [loadEntries, source],
  );

  const navigateUp = useCallback(() => {
    if (!source) return;
    const parent = getParentPathWithinRoot(path, source.rootPath);
    void loadEntries(parent, { query: queryRef.current });
  }, [loadEntries, path, source]);

  const navigateRoot = useCallback(() => {
    if (!source) return;
    void loadEntries(source.rootPath, { query: queryRef.current });
  }, [loadEntries, source]);

  const refresh = useCallback(() => {
    if (!source) return;
    source.clearCacheForPath?.(path);
    void loadEntries(path, { query: queryRef.current });
  }, [loadEntries, path, source]);

  const setQuery = useCallback(
    (nextQuery: string) => {
      queryRef.current = nextQuery;
      setQueryState(nextQuery);
      if (!source?.listEntriesPage) return;
      void loadEntries(path, { query: nextQuery, offset: 0 });
    },
    [loadEntries, path, source],
  );

  const loadMore = useCallback(() => {
    if (!source?.listEntriesPage || nextOffset === null) return;
    void loadEntries(path, {
      query: queryRef.current,
      offset: nextOffset,
      append: true,
    });
  }, [loadEntries, nextOffset, path, source]);

  return {
    path,
    entries,
    isLoading,
    showLoadingIndicator,
    error,
    query,
    setQuery,
    hasMore: nextOffset !== null,
    loadMore,
    totalCount,
    isQueryBacked,
    navigateTo,
    navigateUp,
    navigateRoot,
    refresh,
  };
};
