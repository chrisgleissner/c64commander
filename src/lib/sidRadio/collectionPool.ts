/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ensureStilReady, readStilCollections, type StilCollectionId, type StilCollectionIndex } from "@/lib/hvsc";
import { addLog } from "@/lib/logging";
import type { CollectionPool } from "@/lib/sidRadio/collectionEngine";
import { getMd548PathIndexStats, md548ForVirtualPath } from "@/lib/sidRadio/md5PathIndex";

/**
 * A STIL collection turned into the identities the station engine works in.
 *
 * STIL names tunes by path and the engine by `md5_48`; the songlengths index already holds that
 * mapping. A member whose path is not installed is left out rather than offered and then skipped,
 * so the size a station reports is the number of tunes it can actually play.
 */

type CachedPool = { index: StilCollectionIndex; pathIndexSize: number; pool: CollectionPool };
const cache = new Map<StilCollectionId, CachedPool>();

export const buildCollectionPool = (index: StilCollectionIndex, id: StilCollectionId): CollectionPool => {
  const pool: CollectionPool = { md5_48: [], songNr: [] };
  for (const [pathIndex, songNr] of index.collections[id] ?? []) {
    const md5_48 = md548ForVirtualPath(index.paths[pathIndex]);
    if (!md5_48) continue;
    pool.md5_48.push(md5_48);
    pool.songNr.push(songNr);
  }
  return pool;
};

/**
 * The collection's playable members, or null when STIL is not available.
 *
 * Fetches STIL first when the library was installed before it was stored, which is the one case
 * where starting a collection waits on the network.
 */
export const loadCollectionPool = async (id: StilCollectionId): Promise<CollectionPool | null> => {
  await ensureStilReady();
  const index = await readStilCollections();
  if (!index) {
    addLog("warn", "SID Radio: STIL collections are not available", { service: "sid-radio", collection: id });
    return null;
  }
  const pathIndexSize = getMd548PathIndexStats().size;
  const cached = cache.get(id);
  if (cached && cached.index === index && cached.pathIndexSize === pathIndexSize) return cached.pool;
  const pool = buildCollectionPool(index, id);
  cache.set(id, { index, pathIndexSize, pool });
  return pool;
};

/** Test seam. */
export const __resetCollectionPoolCacheForTest = () => cache.clear();
