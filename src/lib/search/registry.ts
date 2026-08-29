/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { STATIC_SEARCH_ENTRIES } from "@/generated/searchIndex";
import type { SearchEntry } from "@/lib/search/types";

/**
 * Tier 1: what this install actually has — saved devices, playlists, liked tunes, recently played.
 * Hundreds of rows, registered as each store loads and scored synchronously beside tier 0.
 *
 * A registry rather than a hook because the stores that own these load at different times and none
 * of them is mounted under the overlay. Each contributor owns one key and replaces its whole set,
 * so a store that reloads cannot leave stale rows behind.
 */

const contributions = new Map<string, readonly SearchEntry[]>();
const listeners = new Set<() => void>();
let snapshot: readonly SearchEntry[] = STATIC_SEARCH_ENTRIES;

const rebuild = () => {
  const merged: SearchEntry[] = [...STATIC_SEARCH_ENTRIES];
  for (const entries of contributions.values()) merged.push(...entries);
  snapshot = merged;
  for (const listener of listeners) listener();
};

/** Replaces everything `key` contributed. Passing an empty list withdraws the contribution. */
export const registerSearchEntries = (key: string, entries: readonly SearchEntry[]): void => {
  if (entries.length === 0) {
    if (!contributions.delete(key)) return;
  } else {
    contributions.set(key, entries);
  }
  rebuild();
};

/** Tier 0 plus every live tier-1 contribution, as one array. Stable between changes. */
export const getSearchEntries = (): readonly SearchEntry[] => snapshot;

export const subscribeSearchEntries = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test seam: drops every tier-1 contribution. */
export const resetSearchRegistryForTests = (): void => {
  contributions.clear();
  rebuild();
};
