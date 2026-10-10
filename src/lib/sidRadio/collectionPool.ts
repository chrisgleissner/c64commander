/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  ensureStilReady,
  isStilFetchNeeded,
  readStilCollections,
  STIL_COLLECTION_IDS,
  stilCollectionCounts,
  stilUnavailableReason,
  type StilCollectionId,
  type StilCollectionIndex,
} from "@/lib/hvsc";
import { addLog } from "@/lib/logging";
import type { CollectionPool } from "@/lib/sidRadio/collectionEngine";
import { getMd548PathIndexStats, md548ForVirtualPath } from "@/lib/sidRadio/md5PathIndex";

/**
 * A STIL collection turned into the identities the station engine works in.
 *
 * STIL names tunes by path and the engine by `md5_48`; the songlengths index already holds that
 * mapping. A member whose path is not installed is left out rather than offered and then skipped,
 * and a duplicate file (same `md5_48` and tune) counts once, so the size a station reports is the
 * number of tunes it can actually play.
 */

type CachedPool = { index: StilCollectionIndex; pathIndexSize: number; pool: CollectionPool };
const cache = new Map<StilCollectionId, CachedPool>();

export const buildCollectionPool = (index: StilCollectionIndex, id: StilCollectionId): CollectionPool => {
  const pool: CollectionPool = { md5_48: [], songNr: [] };
  const seen = new Set<string>();
  for (const [pathIndex, songNr] of index.collections[id] ?? []) {
    const md5_48 = md548ForVirtualPath(index.paths[pathIndex]);
    if (!md5_48) continue;
    const identity = `${md5_48}#${songNr}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    pool.md5_48.push(md5_48);
    pool.songNr.push(songNr);
  }
  return pool;
};

const poolFor = (index: StilCollectionIndex, id: StilCollectionId): CollectionPool => {
  const pathIndexSize = getMd548PathIndexStats().size;
  const cached = cache.get(id);
  if (cached && cached.index === index && cached.pathIndexSize === pathIndexSize) return cached.pool;
  const pool = buildCollectionPool(index, id);
  cache.set(id, { index, pathIndexSize, pool });
  return pool;
};

/**
 * The collection's playable members, from the STIL already on disk, or null when there is none.
 *
 * Never downloads: a station asks for this on every refill, and the one download a collection may
 * need belongs to its start ({@link prepareCollectionNotes}).
 */
export const loadCollectionPool = async (id: StilCollectionId): Promise<CollectionPool | null> => {
  const index = await readStilCollections();
  if (!index) {
    addLog("warn", "SID Radio: STIL collections are not available", { service: "sid-radio", collection: id });
    return null;
  }
  return poolFor(index, id);
};

/**
 * Tunes per collection, counted the way a station counts them, or null when STIL is not stored.
 *
 * Until the songlengths index has been read no path resolves, so the counts are then the members STIL
 * lists; that happens only while no library is installed, when the tiles are disabled anyway.
 */
export const loadCollectionSizes = async (): Promise<Record<StilCollectionId, number> | null> => {
  const index = await readStilCollections();
  if (!index) return null;
  if (getMd548PathIndexStats().size === 0) return stilCollectionCounts(index);
  return Object.fromEntries(STIL_COLLECTION_IDS.map((id) => [id, poolFor(index, id).md5_48.length])) as Record<
    StilCollectionId,
    number
  >;
};

export type CollectionNotesStatus = "ready" | "no-library" | "demo-library" | "not-downloaded";

/**
 * Make the tune notes available for a collection that is about to start.
 *
 * Downloads STIL at most once per call, and only when it is missing or older than the installed
 * release; `onFetching` is called first in that case so the wait can be shown.
 */
export const prepareCollectionNotes = async (onFetching: () => void): Promise<CollectionNotesStatus> => {
  if (await isStilFetchNeeded()) onFetching();
  await ensureStilReady({ retryNow: true });
  if (await readStilCollections()) return "ready";
  return stilUnavailableReason();
};

/** Test seam. */
export const __resetCollectionPoolCacheForTest = () => cache.clear();
