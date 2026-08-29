/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionRoutingEpoch } from "@/hooks/useC64Connection";
import { SHARED_DISK_LIBRARY_ID, loadDiskLibrary } from "@/lib/disks/diskStore";
import { normalize } from "@/lib/search/score";
import { useHvscArchiveSearch } from "@/pages/playFiles/hooks/useHvscArchiveSearch";
import type { SearchEntry } from "@/lib/search/types";

/**
 * Tier 2: tens of thousands of rows, delegated to the stores that own them (spec.md sections 5.4
 * and 5.9). Debounced and appended when it returns; it never blocks tiers 0 and 1.
 *
 * There is one HVSC search implementation and this is a second caller of it: `useHvscArchiveSearch`
 * is unchanged, with its existing 180 ms debounce and 100-result cap. The config tree is read from
 * the react-query cache the Config page already fills, so nothing new is asked of the device, and
 * the disk library is a local store.
 */

/** The same cap the HVSC hook applies, used for the two local sources so one cannot flood the list. */
const LOCAL_RESULT_LIMIT = 100;

/** The same debounce the HVSC hook applies, so the two halves of tier 2 land together. */
const TIER2_DEBOUNCE_MS = 180;

const diskEntries = (query: string): SearchEntry[] => {
  if (typeof localStorage === "undefined") return [];
  const needle = normalize(query);
  const library = loadDiskLibrary(SHARED_DISK_LIBRARY_ID);
  const matches: SearchEntry[] = [];
  for (const disk of library.disks) {
    if (!normalize(disk.name).includes(needle)) continue;
    matches.push({
      id: `disk.${disk.id}`,
      titleKey: `search.disk.${disk.id}`,
      titleDefault: disk.name,
      subtitleKey: `search.disk.${disk.id}.path`,
      subtitleDefault: disk.path,
      group: "disk",
      target: { kind: "route", path: "/disks" },
    });
    if (matches.length >= LOCAL_RESULT_LIMIT) break;
  }
  return matches;
};

/**
 * The item names a cached `c64-category` response holds. The shape the device returns is
 * `{ "<Category>": { items?: { "<Item>": ... } } }`, the same shape the Config page unwraps.
 */
const itemNamesOf = (data: unknown, category: string): string[] => {
  if (!data || typeof data !== "object") return [];
  const categoryData = (data as Record<string, unknown>)[category];
  if (!categoryData || typeof categoryData !== "object" || Array.isArray(categoryData)) return [];
  const items = (categoryData as { items?: unknown }).items ?? categoryData;
  if (!items || typeof items !== "object") return [];
  return Object.keys(items as Record<string, unknown>).filter((name) => name !== "errors");
};

/**
 * Config items from whatever the Config page has already fetched. A cache read, never a fetch: the
 * device is treated as fragile in this repo, and an item index is not worth a round of requests.
 */
const configEntries = (
  query: string,
  cached: ReadonlyArray<[readonly unknown[], unknown]>,
  routingEpoch: unknown,
): SearchEntry[] => {
  const needle = normalize(query);
  const matches: SearchEntry[] = [];
  const seen = new Set<string>();
  for (const [key, data] of cached) {
    // Checked on the outer loop too. Breaking only out of the inner one let every further category
    // add one more row past the limit, so a one-letter query against a device reporting twenty-odd
    // categories returned roughly twenty more entries than the cap names.
    if (matches.length >= LOCAL_RESULT_LIMIT) break;
    if (key[0] !== "c64-category") continue;
    // The epoch the entry was fetched under. React Query keeps the previous device's categories
    // until they are collected, and offering those would name items the current machine does not
    // have — the resolver would then wait out its ceiling on an anchor that is never rendered.
    if (key[2] !== routingEpoch) continue;
    const category = typeof key[1] === "string" ? key[1] : null;
    if (category === null) continue;
    for (const name of itemNamesOf(data, category)) {
      if (!normalize(name).includes(needle)) continue;
      const id = `config.${category}::${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      matches.push({
        id,
        titleKey: `search.configItem.${id}`,
        titleDefault: name,
        subtitleKey: `search.configItem.${id}.category`,
        subtitleDefault: category,
        group: "config",
        target: { kind: "configItem", category, itemName: name },
        requires: [{ kind: "device" }],
      });
      if (matches.length >= LOCAL_RESULT_LIMIT) break;
    }
  }
  return matches;
};

export interface Tier2State {
  readonly entries: readonly SearchEntry[];
  /** True while the archive scan is still running, so its group header can show a spinner. */
  readonly isSearching: boolean;
  readonly indexUnavailable: boolean;
}

export const useSearchTier2 = (query: string, enabled: boolean): Tier2State => {
  const queryClient = useQueryClient();
  const routingEpoch = useConnectionRoutingEpoch();
  const hvsc = useHvscArchiveSearch({ enabled });
  const [localEntries, setLocalEntries] = useState<readonly SearchEntry[]>([]);

  const trimmed = query.trim();

  // Held in a ref, not a dependency: `hvsc` is a fresh object on every result commit, and
  // depending on it would restart the archive's own debounce on each one.
  const setHvscQuery = hvsc.setQuery;
  useEffect(() => {
    setHvscQuery(enabled ? trimmed : "");
  }, [trimmed, enabled, setHvscQuery]);

  /*
   * Debounced by the same 180 ms the archive uses, and for the same reason.
   *
   * These two scans read the whole disk library out of localStorage and walk every cached config
   * category, and running them synchronously on the keystroke put that work on the path between a
   * key press and the painted list: the HIL latency stage measured 118.8 ms at p95 against a 100 ms
   * budget, and 71.6 ms once they moved off it. Tier 2 is defined as debounced and appended
   * (spec.md section 5.4); this is the half of it that is not the archive.
   */
  useEffect(() => {
    // Cleared first, not left standing through the debounce. The previous query's rows stayed on
    // screen and selectable while the next scan ran, so Enter could open something the typed text
    // no longer named.
    setLocalEntries([]);
    if (!enabled || trimmed === "") {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const cached = queryClient
        .getQueryCache()
        .getAll()
        .map((entry) => [entry.queryKey, entry.state.data] as [readonly unknown[], unknown]);
      setLocalEntries([...diskEntries(trimmed), ...configEntries(trimmed, cached, routingEpoch)]);
    }, TIER2_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, trimmed, queryClient, routingEpoch]);

  const musicEntries = useMemo<SearchEntry[]>(
    () =>
      hvsc.hits.map((hit) => ({
        id: `music.${hit.virtualPath}`,
        titleKey: `search.music.${hit.virtualPath}`,
        titleDefault: hit.title,
        subtitleKey: `search.music.${hit.virtualPath}.author`,
        subtitleDefault: hit.author ?? hit.folder,
        group: "music",
        // Play's archive sheet, opened on this tune's own title rather than on an empty box: the
        // result names one tune out of tens of thousands and arriving at a bare /play loses it.
        target: { kind: "route", path: `/play?find=1&q=${encodeURIComponent(hit.title)}` },
      })),
    [hvsc.hits],
  );

  return useMemo(
    () => ({
      entries: [...localEntries, ...musicEntries],
      isSearching: hvsc.isSearching,
      indexUnavailable: hvsc.indexUnavailable,
    }),
    [localEntries, musicEntries, hvsc.isSearching, hvsc.indexUnavailable],
  );
};
