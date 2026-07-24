/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";
import { getPlayCategory } from "@/lib/playback/fileTypes";
import { getLikedMd5s } from "@/lib/sidRadio/rankingStore";
import { md548FromFullMd5, resolveVirtualPath, type ResolveVirtualPathOptions } from "@/lib/sidRadio/md5PathIndex";

/**
 * Liked Tunes (spec §5.5) — a plain **playable collection** of everything the
 * user has ♥-liked, materialised from `rankingStore` likes → `md5PathIndex` →
 * `PlaylistItem`s. It is *not* a radio: it plays through the existing
 * `startPlaylist`, so normal Shuffle/Repeat apply. It is also the seed pool for
 * Taste stations (diversity-sampled, M3).
 */

export interface LikedTuneEntry {
  /** Full MD5 (the ranking key). */
  md5: string;
  /** md5_48 used for path resolution. */
  md5_48: string;
  /** Resolved HVSC virtual path, or null when the tune is not in the installed HVSC. */
  virtualPath: string | null;
  /** Display label (filename), or the md5 prefix when unresolved. */
  label: string;
  /** True when `virtualPath` resolved (playable); false → greyed "not in current HVSC". */
  resolved: boolean;
}

const basename = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

/**
 * List every liked tune with its current HVSC resolution. Sorted by label for a
 * stable, browsable order. Tunes whose md5_48 no longer resolves (removed by an
 * HVSC update, §2.5) are returned greyed rather than dropped.
 */
export const listLikedTunes = (options?: ResolveVirtualPathOptions): LikedTuneEntry[] => {
  const entries = getLikedMd5s().map<LikedTuneEntry>((md5) => {
    const md5_48 = md548FromFullMd5(md5);
    const virtualPath = resolveVirtualPath(md5_48, options);
    return {
      md5,
      md5_48,
      virtualPath,
      label: virtualPath ? basename(virtualPath) : `Unknown tune (${md5_48})`,
      resolved: virtualPath !== null,
    };
  });
  return entries.sort((a, b) => a.label.localeCompare(b.label) || a.md5.localeCompare(b.md5));
};

/** Build a playable `PlaylistItem` for a resolved liked tune (HVSC source). */
export const buildLikedTunePlaylistItem = (virtualPath: string): PlaylistItem => ({
  id: `liked:${virtualPath}`,
  request: { source: "hvsc", path: virtualPath },
  category: getPlayCategory(virtualPath) ?? "sid",
  label: basename(virtualPath),
  path: virtualPath,
});

/** Materialise the resolved liked tunes into a playable playlist (unresolved skipped). */
export const buildLikedTunePlaylistItems = (entries: LikedTuneEntry[]): PlaylistItem[] =>
  entries
    .filter((entry): entry is LikedTuneEntry & { virtualPath: string } => entry.virtualPath !== null)
    .map((entry) => buildLikedTunePlaylistItem(entry.virtualPath));
