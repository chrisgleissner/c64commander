/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { listFtpDirectory, listFtpDirectoryRecursive } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";
import type { SourceEntry, SourceLocation, SourceRecursiveFailure, SourceRecursiveResult } from "./types";
import { SOURCE_LABELS } from "./sourceTerms";

type FtpCacheRecord = {
  entries: SourceEntry[];
  updatedAt: number;
};

type FtpCacheState = {
  entries: Record<string, FtpCacheRecord>;
  order: string[];
};

const CACHE_KEY = "c64u_ftp_cache:v1";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const FTP_RECURSIVE_MAX_DEPTH = 8;
const FTP_RECURSIVE_MAX_ENTRIES = 5000;

const loadCache = (): FtpCacheState => {
  if (typeof localStorage === "undefined") return { entries: {}, order: [] };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { entries: {}, order: [] };
    const parsed = JSON.parse(raw) as FtpCacheState;
    if (!parsed || typeof parsed !== "object") return { entries: {}, order: [] };
    return {
      entries: parsed.entries ?? {},
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch (error) {
    console.warn("Failed to load FTP cache", { error });
    return { entries: {}, order: [] };
  }
};

const saveCache = (state: FtpCacheState) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist FTP cache", {
      error,
      entryCount: Object.keys(state.entries).length,
    });
  }
};

const buildCacheKey = (host: string, port: number | undefined, path: string) => `${host}:${port ?? ""}:${path || "/"}`;

export const normalizeFtpHost = (host: string) => {
  return stripPortFromDeviceHost(host);
};

const getCachedEntries = (key: string): SourceEntry[] | null => {
  const cache = loadCache();
  const record = cache.entries[key];
  if (!record) return null;
  if (Date.now() - record.updatedAt > CACHE_TTL_MS) return null;
  return record.entries;
};

const setCachedEntries = (key: string, entries: SourceEntry[]) => {
  const cache = loadCache();
  cache.entries[key] = { entries, updatedAt: Date.now() };
  cache.order = [key, ...cache.order.filter((entry) => entry !== key)];
  if (cache.order.length > MAX_CACHE_ENTRIES) {
    const evicted = cache.order.splice(MAX_CACHE_ENTRIES);
    evicted.forEach((entry) => {
      delete cache.entries[entry];
    });
  }
  saveCache(cache);
};

// Refresh clearing only the exact current path left every descendant
// serving up to CACHE_TTL_MS-stale entries: a recursive "Add folder" from
// an ancestor would still resolve unrefreshed children through the cache.
// Clears the exact path plus everything nested under it. See HARD9-082.
const clearCachedEntriesUnderPrefix = (host: string, port: number | undefined, path: string) => {
  const normalizedPath = path || "/";
  const keyPrefix = `${host}:${port ?? ""}:`;
  const exactKey = `${keyPrefix}${normalizedPath}`;
  const descendantPrefix = `${keyPrefix}${normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`}`;
  const cache = loadCache();
  const keysToRemove = new Set(
    Object.keys(cache.entries).filter((key) => key === exactKey || key.startsWith(descendantPrefix)),
  );
  if (!keysToRemove.size) return;
  keysToRemove.forEach((key) => delete cache.entries[key]);
  cache.order = cache.order.filter((entry) => !keysToRemove.has(entry));
  saveCache(cache);
};

const listEntries = async (path: string, options?: { skipCache?: boolean }): Promise<SourceEntry[]> => {
  const { deviceHost: rawHost, password = "" } = getC64APIConfigSnapshot();
  const host = normalizeFtpHost(rawHost);
  const normalizedPath = path && path !== "" ? path : "/";
  const cacheKey = buildCacheKey(host, getStoredFtpPort(), normalizedPath);
  if (!options?.skipCache) {
    const cached = getCachedEntries(cacheKey);
    if (cached) return cached;
  }

  const result = await listFtpDirectory({
    host,
    port: getStoredFtpPort(),
    password,
    path: normalizedPath,
  });
  const entries = (result.entries || []).map((entry) => ({
    type: entry.type,
    name: entry.name,
    path: entry.path,
    sizeBytes: entry.size ?? null,
    modifiedAt: entry.modifiedAt ?? null,
  }));
  setCachedEntries(cacheKey, entries);
  return entries;
};

const attachPartialFailures = (entries: SourceEntry[], failures: SourceRecursiveFailure[]): SourceRecursiveResult => {
  if (!failures.length) return entries as SourceRecursiveResult;
  Object.defineProperty(entries, "partialFailures", {
    value: failures,
    enumerable: false,
    configurable: true,
  });
  return entries as SourceRecursiveResult;
};

const listFilesRecursive = async (
  path: string,
  options?: { signal?: AbortSignal; onProgress?: (delta: number) => void },
): Promise<SourceRecursiveResult> => {
  const signal = options?.signal;
  const onProgress = options?.onProgress;
  const abortError = new DOMException("Aborted", "AbortError");
  const assertNotAborted = () => {
    if (signal?.aborted) {
      throw abortError;
    }
  };

  assertNotAborted();
  if (isNativePlatform()) {
    const { deviceHost: rawHost, password = "" } = getC64APIConfigSnapshot();
    const host = normalizeFtpHost(rawHost);
    const normalizedPath = path && path !== "" ? path : "/";
    const result = await listFtpDirectoryRecursive({
      host,
      port: getStoredFtpPort(),
      password,
      path: normalizedPath,
      maxDepth: FTP_RECURSIVE_MAX_DEPTH,
      maxEntries: FTP_RECURSIVE_MAX_ENTRIES,
    });
    assertNotAborted();
    const entries = (result.entries || []).map((entry) => ({
      type: entry.type,
      name: entry.name,
      path: entry.path,
      sizeBytes: entry.size ?? null,
      modifiedAt: entry.modifiedAt ?? null,
    }));
    if (entries.length > 0) {
      onProgress?.(entries.length);
    }
    const failures = result.partialFailures ?? [];
    // The native walk bails on the first FTP data-channel timeout instead of
    // cascading into more PASV connections against known-flaky firmware -
    // that early exit must be visible, not silently presented as a complete
    // listing. Reuses the existing partialFailures surface. See HARD9-078.
    if (result.timedOut) {
      failures.push({
        path: normalizedPath,
        message: "Listing incomplete: device FTP timed out",
      });
    }
    return attachPartialFailures(entries, failures);
  }

  const queue: Array<{ path: string; depth: number }> = [{ path: path || "/", depth: 0 }];
  const visited = new Set<string>();
  const results: SourceEntry[] = [];
  const partialFailures: SourceRecursiveFailure[] = [];
  const maxConcurrent = 3;
  const pending = new Set<Promise<void>>();
  // Web has no native cap, so a large USB root walks the entire tree - tens
  // of thousands of LIST round-trips, minutes of scanning - and platforms
  // disagree (native silently truncates at the same limits). Apply the same
  // caps here and surface truncation via partialFailures, matching native's
  // messages exactly. See HARD9-081.
  let examinedEntries = 0;
  let capped = false;

  const processPath = async (current: { path: string; depth: number }) => {
    assertNotAborted();
    if (!current.path || visited.has(current.path)) return;
    visited.add(current.path);
    let entries: SourceEntry[];
    try {
      // Recursive scans always read live: a stale cached child (up to
      // CACHE_TTL_MS old) would silently omit files added, or still offer
      // files deleted, since the scan's start (Refresh only ever
      // invalidates the folder it was called on, not every folder a
      // recursive walk happens to visit). See HARD9-082.
      entries = await listEntries(current.path, { skipCache: true });
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") {
        throw error;
      }
      const err = error as Error;
      partialFailures.push({
        path: current.path,
        message: err.message,
      });
      addLog("warn", "FTP recursive directory listing skipped folder", {
        path: current.path,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      });
      return;
    }
    assertNotAborted();
    let filesFound = 0;
    for (const entry of entries) {
      if (capped) break;
      examinedEntries += 1;
      if (examinedEntries > FTP_RECURSIVE_MAX_ENTRIES) {
        partialFailures.push({
          path: current.path,
          message: `FTP recursive listing stopped after ${FTP_RECURSIVE_MAX_ENTRIES} entries`,
        });
        capped = true;
        break;
      }
      if (entry.type === "dir") {
        if (current.depth < FTP_RECURSIVE_MAX_DEPTH) {
          queue.push({ path: entry.path, depth: current.depth + 1 });
        } else {
          partialFailures.push({
            path: entry.path,
            message: `FTP recursive listing max depth ${FTP_RECURSIVE_MAX_DEPTH} reached`,
          });
        }
      } else {
        results.push(entry);
        filesFound += 1;
      }
    }
    // Report incremental progress so a slow broad-folder scan shows a climbing
    // count instead of a stuck "Scanning… 0 items" (S2-DISKS-FTP-RECURSIVE-SCAN-STALL).
    if (filesFound > 0) {
      onProgress?.(filesFound);
    }
  };

  try {
    while ((queue.length || pending.size) && !capped) {
      assertNotAborted();
      while (queue.length && pending.size < maxConcurrent && !capped) {
        assertNotAborted();
        const next = queue.shift();
        if (!next) continue;
        const job = processPath(next).finally(() => pending.delete(job));
        pending.add(job);
      }
      if (pending.size) {
        await Promise.race(pending);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (capped) {
      await Promise.allSettled(Array.from(pending));
    }

    return attachPartialFailures(results, partialFailures);
  } catch (error) {
    if (signal?.aborted) {
      await Promise.allSettled(Array.from(pending));
    }
    throw error;
  }
};

export const createUltimateSourceLocation = (options?: { name?: string }): SourceLocation => ({
  id: "ultimate",
  type: "ultimate",
  name: options?.name?.trim() || SOURCE_LABELS.c64u,
  rootPath: "/",
  isAvailable: true,
  listEntries,
  listFilesRecursive,
  clearCacheForPath: (path) => {
    const { deviceHost: rawHost } = getC64APIConfigSnapshot();
    const host = normalizeFtpHost(rawHost);
    clearCachedEntriesUnderPrefix(host, getStoredFtpPort(), path || "/");
  },
});
