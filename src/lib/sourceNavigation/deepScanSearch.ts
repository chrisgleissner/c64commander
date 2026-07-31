/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Searching a source that has no index, by walking it.
 *
 * HVSC can answer "where is Commando" in a few milliseconds because it keeps a browse index. A
 * folder on the phone, or the card in the Ultimate, has nothing of the sort — the only way to find
 * a file is to list every folder and look. That is seconds to minutes rather than milliseconds, so
 * it is offered as an action the person asks for rather than as a filter that fires while they type
 * (see `searchIsInstant` on {@link SourceLocation}).
 *
 * The matching itself is the same shape as the indexed search, so a result list means the same
 * thing whichever source produced it: tokens are combined with AND, each may match the file name or
 * anywhere in the path, and every result says which folder it came from.
 */

import { foldForSearch } from "@/lib/hvsc/hvscBrowseIndexStore";
import type { SourceEntry, SourceEntryPage, SourceLocation } from "./types";

/**
 * Split a query into the tokens that must all match.
 *
 * Lowercased and stripped of accents, the same way the text is, so "bohme" finds "Böhme" whichever
 * source is being searched. Matching is plain substring, so a token may land inside a word.
 */
export const searchTokens = (query: string): string[] =>
  foldForSearch(query.trim().toLowerCase()).split(/\s+/).filter(Boolean);

/**
 * Does this entry match every token?
 *
 * The name is checked separately from the path even though the path contains it, because the score
 * below needs to know which one matched.
 */
export const matchesAllTokens = (entry: Pick<SourceEntry, "name" | "path">, tokens: string[]): boolean => {
  const haystack = foldForSearch(`${entry.name}\n${entry.path}`.toLowerCase());
  return tokens.every((token) => haystack.includes(token));
};

/** Name matches outrank path matches, and a name that starts with the token outranks one that contains it. */
const scoreEntry = (entry: Pick<SourceEntry, "name" | "path">, tokens: string[]): number => {
  const name = foldForSearch(entry.name.toLowerCase());
  let score = 0;
  for (const token of tokens) {
    if (name.startsWith(token)) continue;
    score += name.includes(token) ? 1 : 2;
  }
  return score;
};

const folderOf = (path: string): string => {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
};

/**
 * Rank and page a set of already-walked files against a query.
 *
 * Separate from the walk so it can be tested without one, and so a caller that already holds the
 * file list (a cached listing, a test) does not have to walk again to search it.
 */
export const rankSearchMatches = (
  entries: SourceEntry[],
  query: string,
  options: { offset?: number; limit?: number } = {},
): SourceEntryPage => {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.floor(options.limit ?? 200));
  const tokens = searchTokens(query);
  if (tokens.length === 0) return { entries: [], totalCount: 0, nextOffset: null };

  const matched = entries
    .filter((entry) => entry.type === "file" && matchesAllTokens(entry, tokens))
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));

  const page = matched
    .slice(offset, offset + limit)
    .map(({ entry }) => ({ ...entry, detail: entry.detail ?? folderOf(entry.path) }));
  const loaded = offset + page.length;
  return { entries: page, totalCount: matched.length, nextOffset: loaded < matched.length ? loaded : null };
};

/**
 * Build a whole-source search out of a recursive listing.
 *
 * The walk itself is whatever the source already does for "add this folder and everything under it",
 * so nothing new has to be taught about how to enumerate that source — including its abort handling,
 * its caching and its depth caps.
 */
export const createDeepScanSearch = (
  listFilesRecursive: SourceLocation["listFilesRecursive"],
  rootPath = "/",
): NonNullable<SourceLocation["searchEntries"]> => {
  return async ({ query, path, offset, limit, signal }) => {
    const tokens = searchTokens(query);
    if (tokens.length === 0) return { entries: [], totalCount: 0, nextOffset: null };
    const files = await listFilesRecursive(path || rootPath, { signal });
    return rankSearchMatches(files, query, { offset, limit });
  };
};
