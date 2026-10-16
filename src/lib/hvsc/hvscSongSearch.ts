/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { normalizeFolderPath } from "./hvscBrowseFolders";
import {
  foldForSearch,
  getHvscDisplayAuthor,
  getHvscDisplayTitle,
  hvscBrowseSongsRevision,
  matchesTokens,
  searchQueryTokens,
  songSearchText,
  type HvscBrowseIndexSnapshot,
  type HvscBrowseIndexedSong,
} from "./hvscBrowseIndexStore";

const FOLDED_DISPLAY = "__foldedDisplay";

/** The lower-cased, accent-folded title and author the ranking compares, cached like the search text. */
const foldedDisplayOf = (song: HvscBrowseIndexedSong): { title: string; author: string } => {
  const cached = (song as unknown as Record<string, unknown>)[FOLDED_DISPLAY];
  if (cached) return cached as { title: string; author: string };
  const folded = {
    title: foldForSearch(getHvscDisplayTitle(song).toLowerCase()),
    author: foldForSearch((getHvscDisplayAuthor(song) ?? "").toLowerCase()),
  };
  Object.defineProperty(song, FOLDED_DISPLAY, { value: folded, enumerable: false, writable: true, configurable: true });
  return folded;
};

/**
 * Search every song in the archive, not only the folder on screen.
 *
 * `listFolderFromBrowseIndex` filters one folder row, which is the right behaviour for narrowing a
 * long folder and the wrong behaviour for finding a tune. HVSC is roughly sixty thousand files
 * arranged by composer, so "find Commando" only works if you already know it is filed under
 * MUSICIANS/H/Hubbard_Rob — which is exactly the thing a search is for.
 *
 * The scan is a linear pass over the song table. That sounds expensive and is not: each song's
 * searchable text — its path, file name, title, author, release and raw SID header — is built once
 * and cached by {@link songSearchText}, so the hot loop is one `includes` per token per song and
 * nothing is allocated for the misses. Ranking runs only over what survived, which is a few hundred
 * rows rather than sixty thousand.
 *
 * Tokens are combined with AND, so "hubbard commando" narrows rather than widens. Each token may
 * match anywhere — including inside a word, so "mando" finds Commando — which is what makes an
 * author-plus-title query work without the caller having to say which word was which. Case and
 * accents are folded on both sides.
 */
export type HvscSongSearchPage = {
  songs: HvscBrowseIndexedSong[];
  /** How many songs matched in total, before `offset`/`limit`. */
  totalSongs: number;
  offset: number;
  limit: number;
  query: string;
};

/**
 * Where a token matched, lowest first.
 *
 * A search for "commando" should put the tune called Commando above every tune whose *path* happens
 * to contain the word, and a search for "hubbard" should put that composer's tunes above a tune
 * called "Hubbard Tribute" by somebody else. Ordering by where the match landed is what does that;
 * ordering by name alone buries the obvious answer under alphabetically earlier accidents.
 */
const TITLE_PREFIX = 0;
const AUTHOR_PREFIX = 1;
const TITLE_MATCH = 2;
const AUTHOR_MATCH = 3;
/**
 * The floor, not a rejection: a song only reaches scoring once every token was found somewhere in
 * its search text, so a token that is in neither the title nor the author matched the path.
 */
const PATH_MATCH = 4;

const scoreToken = (token: string, title: string, author: string): number => {
  if (title.startsWith(token)) return TITLE_PREFIX;
  if (author.startsWith(token)) return AUTHOR_PREFIX;
  if (title.includes(token)) return TITLE_MATCH;
  if (author.includes(token)) return AUTHOR_MATCH;
  return PATH_MATCH;
};

type RankedMatch = { song: HvscBrowseIndexedSong; score: number; title: string };

/**
 * Order two results: where the match landed, then title, then path.
 *
 * Plain comparison rather than `localeCompare`, which on a sixty-thousand-row sort was the single
 * most expensive thing this function did. Both operands are already lowercased and accent-folded to
 * ASCII by the time they get here, so a collator has nothing left to decide — and the path is a
 * tie-break of last resort whose only job is to be stable.
 */
const compareRanked = (a: RankedMatch, b: RankedMatch): number => {
  if (a.score !== b.score) return a.score - b.score;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  if (a.song.virtualPath === b.song.virtualPath) return 0;
  return a.song.virtualPath < b.song.virtualPath ? -1 : 1;
};

type LastSearch = {
  snapshot: HvscBrowseIndexSnapshot;
  revision: number;
  scopePrefix: string;
  tokens: string[];
  matched: HvscBrowseIndexedSong[];
};

/** Recent searches, newest last. A multi-tap letter replaced in place ("rom", then "ron") still narrows from "ro". */
const RECENT_SEARCHES = 6;
let recentSearches: LastSearch[] = [];

/**
 * The smallest set of earlier matches that holds every song the new tokens can match: each old
 * token is contained in a new one, so a song holding the new tokens holds the old ones too. Typing
 * one more letter then scans the few thousand songs that matched before instead of all sixty
 * thousand.
 */
const narrowedCandidates = (
  snapshot: HvscBrowseIndexSnapshot,
  revision: number,
  scopePrefix: string,
  tokens: string[],
): readonly HvscBrowseIndexedSong[] | null => {
  let best: readonly HvscBrowseIndexedSong[] | null = null;
  for (const previous of recentSearches) {
    if (previous.snapshot !== snapshot || previous.revision !== revision || previous.scopePrefix !== scopePrefix)
      continue;
    if (!previous.tokens.every((old) => tokens.some((token) => token.includes(old)))) continue;
    if (best === null || previous.matched.length < best.length) best = previous.matched;
  }
  return best;
};

let lastScannedSongCount = 0;

/** How many songs the last search examined, for tests that check a narrowing search scans less. */
export const getHvscSearchDiagnosticsForTests = () => ({ scannedSongs: lastScannedSongCount });

const rememberSearch = (search: LastSearch) => {
  recentSearches = [...recentSearches.filter((entry) => entry.snapshot === search.snapshot), search].slice(
    -RECENT_SEARCHES,
  );
};

type SongSearchOptions = { path?: string; offset?: number; limit?: number };

/**
 * One whole-archive search, run in slices. `advance` examines songs until the deadline passes and
 * reports whether it has finished; `page` is the answer once it has.
 */
const startSongSearch = (snapshot: HvscBrowseIndexSnapshot, query: string, options: SongSearchOptions) => {
  const normalizedQuery = query.trim().toLowerCase();
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.floor(options.limit ?? 200));
  const tokens = normalizedQuery ? searchQueryTokens(query) : [];
  // A subtree restriction, so the same scan can answer "everywhere" and "everywhere under here".
  const scope = options.path ? normalizeFolderPath(options.path) : "/";
  const scopePrefix = scope === "/" ? "/" : `${scope}/`;

  // Only this many need to be in order. A one-letter query matches sixty thousand tunes and shows a
  // hundred; ranking all sixty thousand to throw away 99.8% of the work is the difference between a
  // search that is felt and one that is not. The total is still counted exactly — it is what tells
  // the listener to narrow the search — but ordering is bounded to the page being asked for.
  const keep = offset + limit;
  const best: RankedMatch[] = [];
  let totalSongs = 0;
  const matched: HvscBrowseIndexedSong[] = [];
  const revision = hvscBrowseSongsRevision(snapshot);
  const candidates =
    tokens.length === 0
      ? []
      : (narrowedCandidates(snapshot, revision, scopePrefix, tokens) ?? Object.values(snapshot.songs));
  let next = 0;

  const examine = (song: HvscBrowseIndexedSong) => {
    if (scopePrefix !== "/" && !song.virtualPath.startsWith(scopePrefix)) return;
    if (!matchesTokens(songSearchText(song), tokens)) return;
    totalSongs += 1;
    matched.push(song);

    // Folded, because the tokens are: an accented title must still be able to score as a title.
    const { title, author } = foldedDisplayOf(song);
    let score = 0;
    for (const token of tokens) score += scoreToken(token, title, author);
    const candidate: RankedMatch = { song, score, title };

    // The common case for a broad query: worse than everything already held, rejected on one
    // integer comparison.
    if (best.length >= keep && compareRanked(candidate, best[best.length - 1]) >= 0) return;
    let low = 0;
    let high = best.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compareRanked(candidate, best[mid]) < 0) high = mid;
      else low = mid + 1;
    }
    best.splice(low, 0, candidate);
    if (best.length > keep) best.pop();
  };

  return {
    advance(deadline: number): boolean {
      while (next < candidates.length) {
        examine(candidates[next]);
        next += 1;
        if ((next & 255) === 0 && performance.now() >= deadline) return false;
      }
      return true;
    },
    page(): HvscSongSearchPage {
      if (tokens.length > 0) {
        lastScannedSongCount = candidates.length;
        rememberSearch({ snapshot, revision, scopePrefix, tokens, matched });
      }
      return {
        songs: best.slice(offset).map((match) => match.song),
        totalSongs,
        offset,
        limit,
        query: normalizedQuery,
      };
    },
  };
};

export const searchSongsFromBrowseIndex = (
  snapshot: HvscBrowseIndexSnapshot,
  query: string,
  options: SongSearchOptions = {},
): HvscSongSearchPage => {
  const search = startSongSearch(snapshot, query, options);
  search.advance(Number.POSITIVE_INFINITY);
  return search.page();
};

/** Main-thread time one slice of a search may take before it lets a key press or a paint through. */
export const SEARCH_SLICE_MS = 8;

const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The same search, in slices of {@link SEARCH_SLICE_MS} with the main thread released between them.
 * Run in one piece, a one-letter query over sixty thousand songs held the main thread for 260 ms on
 * the keypad handset, and a key pressed meanwhile waited for it. Stops between slices once `signal`
 * is aborted, by throwing its reason.
 */
export const searchSongsFromBrowseIndexInSlices = async (
  snapshot: HvscBrowseIndexSnapshot,
  query: string,
  options: SongSearchOptions & { signal?: AbortSignal } = {},
): Promise<HvscSongSearchPage> => {
  const search = startSongSearch(snapshot, query, options);
  while (!search.advance(performance.now() + SEARCH_SLICE_MS)) {
    await yieldToMain();
    options.signal?.throwIfAborted();
  }
  return search.page();
};
