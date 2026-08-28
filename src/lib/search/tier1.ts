/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { buildSavedDevicePrimaryLabel, getSavedDevicesSnapshot } from "@/lib/savedDevices/store";
import { listLikedTunes } from "@/lib/sidRadio/likedTunes";
import { loadRecentlyPlayed } from "@/lib/sidRadio/recentlyPlayed";
import type { SearchEntry } from "@/lib/search/types";

/**
 * Tier 1: what this user has, as opposed to what the app has (spec.md section 5.4).
 *
 * Tier 0 is compiled from YAML and is the same on every installation. Tier 1 is the things only
 * this installation knows about — the machines that have been saved, the tunes that have been
 * liked, what was opened recently — and it is scored synchronously beside tier 0, so every source
 * here reads from memory or localStorage and none of them waits on a device or a database.
 *
 * The playlist is deliberately not here: it lives in an asynchronous repository, and an await on
 * the keystroke path is what tier 2 exists for.
 *
 * Each row names the thing and opens the place that holds it. A saved device opens the switcher
 * rather than switching on the spot, because switching machine mid-session is not something to do
 * from a search result by accident.
 */

/** How many rows one source may contribute. Tier 1 is scored on the keystroke; it is not a list. */
export const TIER1_SOURCE_LIMIT = 50;

export const savedDeviceEntries = (): SearchEntry[] => {
  const { devices } = getSavedDevicesSnapshot();
  return devices.slice(0, TIER1_SOURCE_LIMIT).map((device) => ({
    id: `device.${device.id}`,
    titleKey: `search.device.${device.id}`,
    titleDefault: buildSavedDevicePrimaryLabel(device),
    subtitleKey: `search.device.${device.id}.host`,
    subtitleDefault: device.host,
    group: "action",
    keywords: ["device", "machine", device.host],
    target: { kind: "action", handlerId: "openDeviceSwitcher" },
  }));
};

export const likedTuneEntries = (): SearchEntry[] =>
  listLikedTunes()
    .filter((tune) => tune.resolved)
    .slice(0, TIER1_SOURCE_LIMIT)
    .map((tune) => ({
      id: `liked.${tune.md5_48}`,
      titleKey: `search.liked.${tune.md5_48}`,
      titleDefault: tune.label,
      subtitleKey: `search.liked.${tune.md5_48}.subtitle`,
      subtitleDefault: "Liked tune",
      group: "music",
      keywords: ["liked", "favourite", "favorite"],
      requires: [{ kind: "hvsc" }],
      target: { kind: "action", handlerId: "openLikedTunes" },
    }));

export const recentlyPlayedEntries = (): SearchEntry[] =>
  loadRecentlyPlayed()
    .slice(0, TIER1_SOURCE_LIMIT)
    .map((entry) => ({
      id: `recent.${entry.virtualPath}`,
      titleKey: `search.recent.${entry.virtualPath}`,
      titleDefault: entry.title,
      subtitleKey: `search.recent.${entry.virtualPath}.subtitle`,
      subtitleDefault: entry.author ?? entry.folder,
      group: "music",
      keywords: ["recent", "recently played", "history"],
      target: { kind: "action", handlerId: "openRecentlyPlayed" },
    }));

/** The key each source registers under, so a source can replace its own rows and nobody else's. */
export const TIER1_SOURCES: Readonly<Record<string, () => SearchEntry[]>> = {
  "tier1.savedDevices": savedDeviceEntries,
  "tier1.likedTunes": likedTuneEntries,
  "tier1.recentlyPlayed": recentlyPlayedEntries,
};
