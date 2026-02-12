/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { listFtpDirectory } from '@/lib/ftp/ftpClient';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import { getC64APIConfigSnapshot } from '@/lib/c64api';
import type { SourceEntry, SourceLocation } from './types';
import { SOURCE_LABELS } from './sourceTerms';

type FtpCacheRecord = {
  entries: SourceEntry[];
  updatedAt: number;
};

type FtpCacheState = {
  entries: Record<string, FtpCacheRecord>;
  order: string[];
};

const CACHE_KEY = 'c64u_ftp_cache:v1';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const loadCache = (): FtpCacheState => {
  if (typeof localStorage === 'undefined') return { entries: {}, order: [] };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { entries: {}, order: [] };
    const parsed = JSON.parse(raw) as FtpCacheState;
    if (!parsed || typeof parsed !== 'object') return { entries: {}, order: [] };
    return {
      entries: parsed.entries ?? {},
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch (error) {
    console.warn('Failed to load FTP cache', { error });
    return { entries: {}, order: [] };
  }
};

const saveCache = (state: FtpCacheState) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to persist FTP cache', {
      error,
      entryCount: Object.keys(state.entries).length,
    });
  }
};

const buildCacheKey = (host: string, port: number | undefined, path: string) =>
  `${host}:${port ?? ''}:${path || '/'}`;

export const normalizeFtpHost = (host: string) => {
  if (!host) return host;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end !== -1) return host.slice(0, end + 1);
  }
  return host.split(':')[0] ?? host;
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

const clearCachedEntries = (key: string) => {
  const cache = loadCache();
  delete cache.entries[key];
  cache.order = cache.order.filter((entry) => entry !== key);
  saveCache(cache);
};

const listEntries = async (path: string): Promise<SourceEntry[]> => {
  const { deviceHost: rawHost, password = '' } = getC64APIConfigSnapshot();
  const host = normalizeFtpHost(rawHost);
  const normalizedPath = path && path !== '' ? path : '/';
  const cacheKey = buildCacheKey(host, getStoredFtpPort(), normalizedPath);
  const cached = getCachedEntries(cacheKey);
  if (cached) return cached;

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

const listFilesRecursive = async (path: string, options?: { signal?: AbortSignal }): Promise<SourceEntry[]> => {
  const queue = [path || '/'];
  const visited = new Set<string>();
  const results: SourceEntry[] = [];
  const maxConcurrent = 3;
  const pending = new Set<Promise<void>>();
  const signal = options?.signal;
  const abortError = new DOMException('Aborted', 'AbortError');

  const assertNotAborted = () => {
    if (signal?.aborted) {
      throw abortError;
    }
  };

  const processPath = async (current: string) => {
    assertNotAborted();
    if (!current || visited.has(current)) return;
    visited.add(current);
    const entries = await listEntries(current);
    assertNotAborted();
    entries.forEach((entry) => {
      if (entry.type === 'dir') {
        queue.push(entry.path);
      } else {
        results.push(entry);
      }
    });
  };

  try {
    while (queue.length || pending.size) {
      assertNotAborted();
      while (queue.length && pending.size < maxConcurrent) {
        assertNotAborted();
        const nextPath = queue.shift();
        if (!nextPath) continue;
        const job = processPath(nextPath).finally(() => pending.delete(job));
        pending.add(job);
      }
      if (pending.size) {
        await Promise.race(pending);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return results;
  } catch (error) {
    if (signal?.aborted) {
      await Promise.allSettled(Array.from(pending));
    }
    throw error;
  }
};

export const createUltimateSourceLocation = (): SourceLocation => ({
  id: 'ultimate',
  type: 'ultimate',
  name: SOURCE_LABELS.c64u,
  rootPath: '/',
  isAvailable: true,
  listEntries,
  listFilesRecursive,
  clearCacheForPath: (path) => {
    const { deviceHost: rawHost } = getC64APIConfigSnapshot();
    const host = normalizeFtpHost(rawHost);
    const cacheKey = buildCacheKey(host, getStoredFtpPort(), path || '/');
    clearCachedEntries(cacheKey);
  },
});
