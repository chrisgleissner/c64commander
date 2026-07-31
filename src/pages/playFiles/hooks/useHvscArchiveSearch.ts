/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { searchHvscSongs } from "@/lib/hvsc";
import { getHvscDisplayAuthor, getHvscDisplayTitle } from "@/lib/hvsc/hvscBrowseIndexStore";
import { addErrorLog } from "@/lib/logging";

/**
 * Finding a tune by name, anywhere in HVSC.
 *
 * Shared by the two places that need it: picking tunes to add to the playlist, and reaching for one
 * by name while a station is running. Both want the same thing — type a title or a composer, get
 * back tunes from the whole archive rather than from whichever folder happens to be open.
 *
 * The search itself is a pass over the browse index and costs no I/O, so it runs while the person is
 * typing. It is still debounced: sixty thousand rows scanned on every keypress is work the phone can
 * spend better, and a list that reflows on each letter is harder to read than one that settles.
 */

/** One tune, in the shape the list draws. */
export type HvscSearchHit = {
  /** Stable across renders; the virtual path is unique within the archive. */
  virtualPath: string;
  title: string;
  author: string | null;
  /** The folder the tune lives in — two composers can both have a "Theme". */
  folder: string;
  /** The subsong to start at, when the archive names one. */
  songNr?: number;
  subsongCount?: number;
  durationMs?: number;
};

export type HvscArchiveSearchState = {
  query: string;
  setQuery: (query: string) => void;
  hits: HvscSearchHit[];
  /** How many matched in total, which can exceed what is shown. */
  totalCount: number;
  isSearching: boolean;
  /** True once a search has run and the query is non-empty; drives the empty state. */
  hasSearched: boolean;
  /**
   * True when the browse index is not loaded.
   *
   * Distinct from "nothing matched": the archive may be full of the tune being looked for and simply
   * not indexed yet, and telling somebody their tune does not exist because of that is a lie.
   */
  indexUnavailable: boolean;
  clear: () => void;
};

const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 100;

const folderOf = (virtualPath: string): string => {
  const index = virtualPath.lastIndexOf("/");
  return index <= 0 ? "/" : virtualPath.slice(0, index);
};

export const useHvscArchiveSearch = (
  options: {
    enabled?: boolean;
    /**
     * A query to start from, applied whenever it changes to a non-empty value.
     *
     * Used when the search is opened from somewhere that already knows what is being looked for —
     * tapping a composer's name on the now-playing card. Typing then replaces it as normal; this
     * seeds the box, it does not lock it.
     */
    initialQuery?: string;
  } = {},
): HvscArchiveSearchState => {
  const enabled = options.enabled ?? true;
  const [query, setQueryState] = useState("");
  const [hits, setHits] = useState<HvscSearchHit[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [indexUnavailable, setIndexUnavailable] = useState(false);
  const timerRef = useRef<number | null>(null);
  // Only the newest query may write results; a slower earlier one has to be dropped rather than
  // allowed to replace what the person is now looking at.
  const runRef = useRef(0);

  const reset = useCallback(() => {
    setHits([]);
    setTotalCount(0);
    setHasSearched(false);
    setIndexUnavailable(false);
    setIsSearching(false);
  }, []);

  const run = useCallback(async (nextQuery: string) => {
    const run = runRef.current + 1;
    runRef.current = run;
    setIsSearching(true);
    try {
      const page = await searchHvscSongs({ query: nextQuery, limit: RESULT_LIMIT });
      if (runRef.current !== run) return;
      if (!page) {
        setIndexUnavailable(true);
        setHits([]);
        setTotalCount(0);
        setHasSearched(true);
        return;
      }
      setIndexUnavailable(false);
      setHits(
        page.songs.map((song) => ({
          virtualPath: song.virtualPath,
          title: getHvscDisplayTitle(song),
          author: getHvscDisplayAuthor(song),
          folder: folderOf(song.virtualPath),
          songNr:
            song.trackSubsongs?.find((entry) => entry.isDefault)?.songNr ??
            song.defaultSong ??
            song.sidMetadata?.startSong ??
            undefined,
          subsongCount: song.trackSubsongs?.length ?? song.subsongCount ?? song.sidMetadata?.songs ?? undefined,
          durationMs: song.durationSeconds == null ? undefined : Math.round(song.durationSeconds * 1000),
        })),
      );
      setTotalCount(page.totalSongs);
      setHasSearched(true);
    } catch (error) {
      if (runRef.current !== run) return;
      addErrorLog("HVSC search failed", { error: (error as Error).message, query: nextQuery });
      setHits([]);
      setTotalCount(0);
      setHasSearched(true);
      // A search that threw says nothing about whether the index is loaded, and an earlier search
      // may have set that flag. Leaving it would tell the listener their library is not ready when
      // the truth is that one query failed.
      setIndexUnavailable(false);
    } finally {
      if (runRef.current === run) setIsSearching(false);
    }
  }, []);

  const setQuery = useCallback(
    (nextQuery: string) => {
      setQueryState(nextQuery);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (!enabled || !nextQuery.trim()) {
        // Bump the run counter so a search already in flight cannot land after the box was cleared.
        runRef.current += 1;
        reset();
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void run(nextQuery);
      }, DEBOUNCE_MS);
    },
    [enabled, reset, run],
  );

  const clear = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    runRef.current += 1;
    setQueryState("");
    reset();
  }, [reset]);

  const initialQuery = options.initialQuery ?? "";
  useEffect(() => {
    if (!enabled || !initialQuery.trim()) return;
    // Runs immediately rather than through the debounce: nobody is typing, and the results are the
    // reason the sheet was opened.
    setQueryState(initialQuery);
    void run(initialQuery);
  }, [enabled, initialQuery, run]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { query, setQuery, hits, totalCount, isSearching, hasSearched, indexUnavailable, clear };
};
