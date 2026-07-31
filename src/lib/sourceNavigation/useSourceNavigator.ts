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

/**
 * How far a query reaches.
 *
 * "folder" narrows the listing on screen, which is what a filter is for. "source" searches the whole
 * thing, which is what finding a tune by name actually needs — HVSC files by composer, so a title
 * you can name lives in a folder you cannot guess.
 */
export type SourceSearchScope = "folder" | "source";

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
  /** True when this source can search beyond the folder on screen at all. */
  canSearchSource?: boolean;
  /** True when that search is an index lookup and can run on every keystroke. */
  searchIsInstant?: boolean;
  searchScope: SourceSearchScope;
  setSearchScope: (scope: SourceSearchScope) => void;
  /** True while showing search results rather than a folder listing. */
  isSearching: boolean;
  /**
   * Run the whole-source search for the current query.
   *
   * Called automatically on every keystroke for an indexed source; for a source that has to be
   * walked it is only ever called from an explicit action, which is why it is exposed at all.
   */
  runSourceSearch?: () => void;
  /** Abandon the results and go back to the folder listing. */
  clearSearch: () => void;
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

/** How long to let typing settle before an indexed whole-source search runs. */
const SEARCH_DEBOUNCE_MS = 180;

export const useSourceNavigator = (source: SourceLocation | null): SourceNavigatorState => {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQueryState] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [searchScope, setSearchScopeState] = useState<SourceSearchScope>("folder");
  const [isSearching, setIsSearching] = useState(false);
  const loadingTokenRef = useRef(0);
  const loadingShownAtRef = useRef<number | null>(null);
  const queryRef = useRef("");
  const searchScopeRef = useRef<SourceSearchScope>("folder");
  const searchDebounceRef = useRef<number | null>(null);
  /** The walk currently in flight, so a superseded one can be stopped rather than merely ignored. */
  const searchAbortRef = useRef<AbortController | null>(null);
  const isQueryBacked = Boolean(source?.listEntriesPage);
  const canSearchSource = Boolean(source?.searchEntries);
  const searchIsInstant = Boolean(source?.searchIsInstant);

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
        // A folder listing has arrived, so whatever search results were on screen are gone. Leaving
        // the flag set would keep the results header over an ordinary listing.
        setIsSearching(false);
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

  /**
   * Search the whole source for the current query.
   *
   * Shares `loadingTokenRef` with the folder loader on purpose: a search and a navigation are two
   * answers to "what should the list show", and whichever was asked for last must win. Separate
   * tokens would let a slow walk overwrite a folder the person had already navigated to.
   *
   * Superseding also *aborts*, rather than only ignoring the answer. Discarding a result is enough
   * for an index lookup, which has already finished by the time it is discarded — but a walked
   * source is minutes of listing over FTP or the Capacitor bridge, and abandoning one without
   * stopping it leaves it running against a source the next one is about to hammer.
   *
   * The scope is deliberately the whole source. `searchEntries` accepts a subtree, and the control
   * this is driven from offers exactly two choices — this folder, which is the ordinary listing, and
   * everywhere, which is this. A third "everywhere below here" would be a scope most people would
   * have to think about, for a question the folder listing already answers.
   */
  const runSearchNow = useCallback(
    async (nextQuery: string, options?: { offset?: number; append?: boolean }) => {
      const search = source?.searchEntries;
      if (!source || !search) return;
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        setIsSearching(false);
        void loadEntries(path, { query: "" });
        return;
      }
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const token = loadingTokenRef.current + 1;
      loadingTokenRef.current = token;
      setIsLoading(true);
      setError(null);
      setIsSearching(true);
      try {
        const page = await search({
          query: trimmed,
          offset: options?.offset ?? 0,
          limit: PAGE_SIZE,
          signal: controller.signal,
        });
        if (loadingTokenRef.current !== token) return; // superseded — discard
        setEntries((currentEntries) =>
          options?.append ? mergeEntriesByPath(currentEntries, page.entries) : page.entries,
        );
        setTotalCount(page.totalCount);
        setNextOffset(page.nextOffset);
      } catch (err) {
        if (loadingTokenRef.current !== token) return;
        const error = err as Error;
        // A cancelled walk is the person changing their mind, not a failure to report.
        if (error.name === "AbortError") return;
        setError(error.message);
        addErrorLog("Source search failed", {
          sourceId: source.id,
          sourceType: source.type,
          query: trimmed,
          error: { name: error.name, message: error.message, stack: error.stack },
        });
      } finally {
        if (loadingTokenRef.current === token) setIsLoading(false);
      }
    },
    [loadEntries, path, source],
  );

  useEffect(() => {
    if (!source) return;
    queryRef.current = "";
    setQueryState("");
    searchScopeRef.current = "folder";
    setSearchScopeState("folder");
    setIsSearching(false);
    const stored = getStoredPath(source);
    const initialPath = stored ? ensureWithinRoot(stored, source.rootPath) : source.rootPath;
    void loadEntries(initialPath, { query: "" });
  }, [loadEntries, source]);

  // A pending keystroke must not fire into an unmounted sheet, or into the next source.
  useEffect(
    () => () => {
      if (searchDebounceRef.current !== null) window.clearTimeout(searchDebounceRef.current);
      // An unmounted sheet must not leave a walk running against the source.
      searchAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!source) return;
    setStoredPath(source, path);
  }, [path, source]);

  /**
   * Go to a folder, leaving any whole-source search behind.
   *
   * Search results are a flat list drawn from everywhere, so "up" and "root" have nothing to mean
   * inside them: reaching for one is how a person says they are done searching. Carrying the query
   * over would land them on a folder listing filtered by a search term they had moved on from.
   */
  const goToFolder = useCallback(
    (nextPath: string) => {
      if (!source) return;
      if (searchDebounceRef.current !== null) {
        window.clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      searchAbortRef.current?.abort();
      const leavingSearch = searchScopeRef.current === "source";
      if (leavingSearch) {
        queryRef.current = "";
        setQueryState("");
        searchScopeRef.current = "folder";
        setSearchScopeState("folder");
      }
      void loadEntries(nextPath, { query: queryRef.current });
    },
    [loadEntries, source],
  );

  const navigateTo = useCallback((nextPath: string) => goToFolder(nextPath), [goToFolder]);

  const navigateUp = useCallback(() => {
    if (!source) return;
    goToFolder(getParentPathWithinRoot(path, source.rootPath));
  }, [goToFolder, path, source]);

  const navigateRoot = useCallback(() => {
    if (!source) return;
    goToFolder(source.rootPath);
  }, [goToFolder, source]);

  const refresh = useCallback(() => {
    if (!source) return;
    source.clearCacheForPath?.(path);
    goToFolder(path);
  }, [goToFolder, path, source]);

  const cancelPendingSearch = useCallback(() => {
    // Both halves of "in flight": a keystroke that has not fired yet, and a walk that has.
    searchAbortRef.current?.abort();
    if (searchDebounceRef.current === null) return;
    window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = null;
  }, []);

  const setQuery = useCallback(
    (nextQuery: string) => {
      queryRef.current = nextQuery;
      setQueryState(nextQuery);
      cancelPendingSearch();
      if (searchScopeRef.current === "source" && source?.searchEntries) {
        // Only an index may run while the person is still typing. A source that has to be walked
        // waits for them to ask, or every keystroke would start a fresh walk of the whole card.
        if (!source.searchIsInstant) return;
        searchDebounceRef.current = window.setTimeout(() => {
          searchDebounceRef.current = null;
          void runSearchNow(nextQuery);
        }, SEARCH_DEBOUNCE_MS);
        return;
      }
      if (!source?.listEntriesPage) return;
      void loadEntries(path, { query: nextQuery, offset: 0 });
    },
    [cancelPendingSearch, loadEntries, path, runSearchNow, source],
  );

  const setSearchScope = useCallback(
    (scope: SourceSearchScope) => {
      searchScopeRef.current = scope;
      setSearchScopeState(scope);
      cancelPendingSearch();
      if (scope === "source") {
        if (!source?.searchEntries) return;
        // Switching to a whole-source scope with a query already typed should show the results, not
        // wait for another keystroke — but only when the search is free. A walk still waits.
        if (source.searchIsInstant && queryRef.current.trim()) void runSearchNow(queryRef.current);
        return;
      }
      setIsSearching(false);
      void loadEntries(path, { query: queryRef.current, offset: 0 });
    },
    [cancelPendingSearch, loadEntries, path, runSearchNow, source],
  );

  const runSourceSearch = useCallback(() => {
    cancelPendingSearch();
    searchScopeRef.current = "source";
    setSearchScopeState("source");
    void runSearchNow(queryRef.current);
  }, [cancelPendingSearch, runSearchNow]);

  const clearSearch = useCallback(() => {
    cancelPendingSearch();
    queryRef.current = "";
    setQueryState("");
    searchScopeRef.current = "folder";
    setSearchScopeState("folder");
    setIsSearching(false);
    void loadEntries(path, { query: "", offset: 0 });
  }, [cancelPendingSearch, loadEntries, path]);

  const loadMore = useCallback(() => {
    if (nextOffset === null) return;
    if (isSearching) {
      void runSearchNow(queryRef.current, { offset: nextOffset, append: true });
      return;
    }
    if (!source?.listEntriesPage) return;
    void loadEntries(path, {
      query: queryRef.current,
      offset: nextOffset,
      append: true,
    });
  }, [isSearching, loadEntries, nextOffset, path, runSearchNow, source]);

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
    canSearchSource,
    searchIsInstant,
    searchScope,
    setSearchScope,
    isSearching,
    runSourceSearch: canSearchSource ? runSourceSearch : undefined,
    clearSearch,
    navigateTo,
    navigateUp,
    navigateRoot,
    refresh,
  };
};
