/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isRefusedFtpListing, listFtpDirectory, listFtpDirectoryRecursive } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";
import { isKnownUnavailable, isPluginMethodUnimplemented, recordUnavailable } from "@/lib/native/pluginAvailability";
import type { SourceEntry, SourceLocation, SourceRecursiveFailure, SourceRecursiveResult } from "./types";
import { isDeviceAnswer, UnreadableFolderError } from "./connectionFailure";
import { createDeepScanSearch } from "./deepScanSearch";
import { normalizeSourcePath } from "./paths";
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

const folderName = (path: string) => path.replace(/\/+$/, "").replace(/^.*\//, "");
const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

/*
 * The Ultimate's FTP server answers LIST for a folder it cannot open (an unreadable SD card) by
 * listing the parent filtered to the folder's own name (`vfs_opendir` in 1541ultimate), so the
 * folder appears to contain itself. One level down the parent is unreadable too, and the server
 * refuses with 451. A real same-named child lists normally, even when it is empty.
 */
const isUnreadableFolderEcho = async (
  request: { host: string; port: number; password: string },
  path: string,
  entries: { type: string; name: string; path: string }[],
) => {
  const [only] = entries;
  if (path === "/" || entries.length !== 1 || only.type !== "dir") return false;
  if (only.name.toLowerCase() !== folderName(path).toLowerCase()) return false;
  try {
    await listFtpDirectory({ ...request, path: only.path, refusalExpected: true });
    return false;
  } catch (error) {
    if (isRefusedFtpListing(error)) {
      addLog("info", "The C64 could not read a folder", { path, checkedWith: only.path, error: describeError(error) });
      return true;
    }
    throw new Error(`Could not check whether ${path} can be read: ${describeError(error)}`, { cause: error });
  }
};

/** The key a folder is cached under: duplicate slashes collapsed and no trailing slash, except for the root. */
const listingFolderPath = (path: string) => normalizeSourcePath(path).replace(/(.)\/$/, "$1");

const listEntries = async (path: string, options?: { skipCache?: boolean }): Promise<SourceEntry[]> => {
  const { deviceHost: rawHost, password = "" } = getC64APIConfigSnapshot();
  const host = normalizeFtpHost(rawHost);
  const normalizedPath = listingFolderPath(path);
  const cacheKey = buildCacheKey(host, getStoredFtpPort(), normalizedPath);
  if (!options?.skipCache) {
    const cached = getCachedEntries(cacheKey);
    if (cached) return cached;
  }

  const request = { host, port: getStoredFtpPort(), password };
  const result = await listFtpDirectory({ ...request, path: normalizedPath });
  if (await isUnreadableFolderEcho(request, normalizedPath, result.entries || [])) {
    throw new UnreadableFolderError(path || "/");
  }
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
  if (!failures.length) return entries;
  Object.defineProperty(entries, "partialFailures", {
    value: failures,
    enumerable: false,
    configurable: true,
  });
  return entries;
};

/** One folder that times out can be a single stalled data channel; two in a row mean the device is gone. */
const FTP_RECURSIVE_LOST_FOLDERS_BEFORE_STOP = 2;

const FTP_LIST_RECURSIVE_METHOD = "FtpClient.listDirectoryRecursive";

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
  /*
   * A native platform without this method rejected with Capacitor's raw
   * `"FtpClient.listDirectoryRecursive()" is not implemented on ios`, which reached the user as an
   * error toast when they selected a folder in Play or Disks. iOS implements it now, so this is a
   * safety net rather than the iOS path, and it stays because it is the only thing standing
   * between a future missing bridge method and a raw Capacitor message on screen. The walker below
   * is not a native-versus-web distinction - it is a complete implementation web has always used,
   * with the same depth and entry caps - so falling through to it is a real degradation rather
   * than a failure. Latched, because a missing method stays missing (HARD27-003).
   */
  if (isNativePlatform() && !isKnownUnavailable(FTP_LIST_RECURSIVE_METHOD)) {
    const { deviceHost: rawHost, password = "" } = getC64APIConfigSnapshot();
    const host = normalizeFtpHost(rawHost);
    const normalizedPath = path && path !== "" ? path : "/";
    let result: Awaited<ReturnType<typeof listFtpDirectoryRecursive>>;
    try {
      result = await listFtpDirectoryRecursive({
        host,
        port: getStoredFtpPort(),
        password,
        path: normalizedPath,
        maxDepth: FTP_RECURSIVE_MAX_DEPTH,
        maxEntries: FTP_RECURSIVE_MAX_ENTRIES,
      });
    } catch (error) {
      if (!isPluginMethodUnimplemented(error)) throw error;
      if (recordUnavailable(FTP_LIST_RECURSIVE_METHOD)) {
        addLog("info", "Recursive FTP listing runs in TypeScript on this platform", {
          method: FTP_LIST_RECURSIVE_METHOD,
        });
      }
      // Re-entered rather than duplicating the walker: the method is latched above, so the
      // second entry takes the TypeScript branch.
      return listFilesRecursive(path, options);
    }
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
    // The native walk bails on the first lost connection (a data-channel timeout, a closed or
    // broken socket) instead of cascading into more PASV connections against known-flaky
    // firmware - that early exit must be visible, not silently presented as a complete
    // listing. Reuses the existing partialFailures surface. See HARD9-078.
    if (result.timedOut || result.refused) {
      failures.push({
        path: normalizedPath,
        message: result.refused
          ? "Listing incomplete: the device refused connections"
          : "Listing incomplete: the device stopped answering",
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
  let consecutiveLostFolders = 0;

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
      consecutiveLostFolders = isDeviceAnswer(err) ? 0 : consecutiveLostFolders + 1;
      if (consecutiveLostFolders >= FTP_RECURSIVE_LOST_FOLDERS_BEFORE_STOP) {
        // Every later folder would fail the same way, each after its own timeout.
        if (!capped) {
          partialFailures.push({ path: current.path, message: "Listing incomplete: the device stopped answering" });
        }
        capped = true;
      }
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
    consecutiveLostFolders = 0;
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

const peekCachedEntries = (path: string): SourceEntry[] | null => {
  const host = normalizeFtpHost(getC64APIConfigSnapshot().deviceHost);
  return getCachedEntries(buildCacheKey(host, getStoredFtpPort(), listingFolderPath(path)));
};

export const createUltimateSourceLocation = (options?: { name?: string }): SourceLocation => ({
  id: "ultimate",
  type: "ultimate",
  name: options?.name?.trim() || SOURCE_LABELS.c64u,
  rootPath: "/",
  isAvailable: true,
  // One source for whichever Ultimate is connected: a folder on one device is usually absent on another.
  navigationScope: () => normalizeFtpHost(getC64APIConfigSnapshot().deviceHost),
  listEntries,
  peekCachedEntries,
  listFilesRecursive,
  // A walk over FTP, so it runs only when asked for — never per keystroke.
  searchEntries: createDeepScanSearch(listFilesRecursive),
  searchIsInstant: false,
  clearCacheForPath: (path) => {
    const { deviceHost: rawHost } = getC64APIConfigSnapshot();
    const host = normalizeFtpHost(rawHost);
    clearCachedEntriesUnderPrefix(host, getStoredFtpPort(), listingFolderPath(path || "/"));
  },
});
