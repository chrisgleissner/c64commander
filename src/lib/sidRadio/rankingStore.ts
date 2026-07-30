/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Ambient ranking store — the user's Like ♥ / Not-for-me ✕ signal (spec §5.1),
 * keyed by **full MD5** so a rating follows a tune across HVSC/local/Ultimate
 * sources and survives re-indexing. It backs Liked Tunes (§5.5) and seeds Taste
 * stations, and steers every station.
 *
 * Durability: a single small blob persisted to **IndexedDB** when available,
 * else **localStorage** (mirrors the playlist repository's fallback). Rankings
 * are tiny, so the whole map is written on each mutation. A `CustomEvent`
 * broadcasts every change (§6.4 broadcast pattern).
 */

import { addErrorLog } from "@/lib/logging";

export type RankingSignal = "like" | "notForMe";

export interface RankingSnapshot {
  likes: Set<string>;
  notForMe: Set<string>;
  /** Stable id — a pure function of the (sorted) rankings; input to engine determinism (D15). */
  id: string;
}

export const RANKING_CHANGED_EVENT = "c64u-sid-ranking-changed";

const STORAGE_KEY = "c64u_sid_rankings";
const DB_NAME = "c64u-sid-rankings";
const STORE = "state";
const RECORD_KEY = "rankings";

const normalizeMd5 = (md5: string): string => md5.trim().toLowerCase();

const fnv1aHex = (text: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

// --- durable backends ---

type RankingMap = Record<string, RankingSignal>;

const canUseIndexedDb = () => typeof indexedDB !== "undefined";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const idbLoad = async (): Promise<RankingMap> => {
  const db = await openDb();
  try {
    return await new Promise<RankingMap>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(RECORD_KEY);
      request.onsuccess = () => resolve((request.result as RankingMap) ?? {});
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
};

const idbSave = async (map: RankingMap): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(map, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const lsLoad = (): RankingMap => {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RankingMap) : {};
  } catch (error) {
    addErrorLog("Failed to read SID rankings from localStorage", { error: (error as Error).message });
    return {};
  }
};

const lsSave = (map: RankingMap): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    // Quota / disabled storage — ambient ranking is best-effort.
    addErrorLog("Failed to persist SID rankings to localStorage", { error: (error as Error).message });
  }
};

let backend: "idb" | "ls" | null = null;
const resolveBackend = (): "idb" | "ls" => {
  if (!backend) backend = canUseIndexedDb() ? "idb" : "ls";
  return backend;
};

const durableLoad = async (): Promise<RankingMap> => {
  if (resolveBackend() === "idb") {
    try {
      return await idbLoad();
    } catch {
      backend = "ls";
    }
  }
  return lsLoad();
};

const durableSave = async (map: RankingMap): Promise<void> => {
  if (resolveBackend() === "idb") {
    try {
      await idbSave(map);
      return;
    } catch {
      backend = "ls";
    }
  }
  lsSave(map);
};

// --- in-memory cache + public API ---

const cache = new Map<string, RankingSignal>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

const broadcast = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(RANKING_CHANGED_EVENT));
};

/**
 * Hydrate the in-memory cache from durable storage (idempotent).
 *
 * Broadcasts when hydration actually brought ratings in, so surfaces that read the cache
 * synchronously — the ♥/✕ affordance, Liked Tunes — re-read it instead of showing an unrated app
 * until the first write of the session hydrates it as a side effect.
 */
export const loadRankings = async (): Promise<void> => {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      const map = await durableLoad();
      cache.clear();
      for (const [md5, signal] of Object.entries(map)) {
        if (signal === "like" || signal === "notForMe") cache.set(normalizeMd5(md5), signal);
      }
      loaded = true;
      loadPromise = null;
      if (cache.size > 0) broadcast();
    })();
  }
  await loadPromise;
};

const persist = async (): Promise<void> => {
  await durableSave(Object.fromEntries(cache) as RankingMap);
  broadcast();
};

/** Read a tune's ranking synchronously from the cache (null if unrated). */
export const getRanking = (md5: string): RankingSignal | null => cache.get(normalizeMd5(md5)) ?? null;

/** Set (or overwrite) a tune's ranking. */
export const setRanking = async (md5: string, signal: RankingSignal): Promise<void> => {
  await loadRankings();
  cache.set(normalizeMd5(md5), signal);
  await persist();
};

/** Remove a single tune's ranking (un-like / un-dislike). */
export const clearRanking = async (md5: string): Promise<void> => {
  await loadRankings();
  if (cache.delete(normalizeMd5(md5))) await persist();
};

/** Clear every ranking ("Clear my rankings"). */
export const clearAllRankings = async (): Promise<void> => {
  cache.clear();
  loaded = true;
  await durableSave({});
  broadcast();
};

/** Full-MD5s the user has liked (order unspecified). */
export const getLikedMd5s = (): string[] =>
  [...cache.entries()].filter(([, signal]) => signal === "like").map(([md5]) => md5);

/** Full-MD5s the user has marked not-for-me. */
export const getNotForMeMd5s = (): string[] =>
  [...cache.entries()].filter(([, signal]) => signal === "notForMe").map(([md5]) => md5);

/** A deterministic snapshot of the current rankings (engine determinism input). */
export const getRankingSnapshot = (): RankingSnapshot => {
  const likes = new Set<string>();
  const notForMe = new Set<string>();
  for (const [md5, signal] of cache) (signal === "like" ? likes : notForMe).add(md5);
  const id = fnv1aHex(
    [...cache.entries()]
      .map(([md5, signal]) => `${md5}:${signal}`)
      .sort()
      .join("|"),
  );
  return { likes, notForMe, id };
};

/** Subscribe to ranking changes; returns an unsubscribe fn. */
export const subscribeRankings = (listener: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(RANKING_CHANGED_EVENT, handler);
  return () => window.removeEventListener(RANKING_CHANGED_EVENT, handler);
};

/** Test helper: drop the in-memory cache (simulate a fresh app start) but keep durable data. */
export const simulateRankingRestartForTests = async (): Promise<void> => {
  cache.clear();
  loaded = false;
  loadPromise = null;
};
