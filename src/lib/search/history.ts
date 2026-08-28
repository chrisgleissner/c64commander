/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";

/** spec.md section 5.10. Both lists are pruned on write. */
export const SEARCH_RECENT_KEY = "c64u_search_recent:v1";
export const SEARCH_PICKED_KEY = "c64u_search_picked:v1";

export const RECENT_QUERY_LIMIT = 10;
export const PICKED_ENTRY_LIMIT = 20;

const readList = (key: string): string[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch (error) {
    addErrorLog("Failed to read search history", { key, error: (error as Error).message });
    return [];
  }
};

const writeList = (key: string, values: readonly string[]): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch (error) {
    addErrorLog("Failed to persist search history", { key, error: (error as Error).message });
  }
};

/** Newest first, de-duplicated case-insensitively, capped. Pure, so the rule is testable. */
export const foldRecent = (existing: readonly string[], value: string, limit: number): string[] => {
  const trimmed = value.trim();
  if (trimmed === "") return [...existing].slice(0, limit);
  const lowered = trimmed.toLowerCase();
  return [trimmed, ...existing.filter((entry) => entry.toLowerCase() !== lowered)].slice(0, limit);
};

export const loadRecentQueries = (): string[] => readList(SEARCH_RECENT_KEY).slice(0, RECENT_QUERY_LIMIT);

/**
 * A query is recorded only when a result was activated from it, so typing that led nowhere is never
 * stored — a half-typed name is not something a user asked to keep.
 */
export const recordRecentQuery = (query: string): void => {
  writeList(SEARCH_RECENT_KEY, foldRecent(loadRecentQueries(), query, RECENT_QUERY_LIMIT));
};

export const loadPickedEntryIds = (): string[] => readList(SEARCH_PICKED_KEY).slice(0, PICKED_ENTRY_LIMIT);

export const recordPickedEntry = (entryId: string): void => {
  writeList(SEARCH_PICKED_KEY, foldRecent(loadPickedEntryIds(), entryId, PICKED_ENTRY_LIMIT));
};

export const clearSearchHistory = (): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(SEARCH_RECENT_KEY);
  localStorage.removeItem(SEARCH_PICKED_KEY);
};
