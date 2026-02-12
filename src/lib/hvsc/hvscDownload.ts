/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { HvscProgressEvent } from './hvscTypes';
import { getHvscCacheDir, writeCachedArchive, deleteCachedArchive, writeCachedArchiveMarker, readCachedArchiveMarker } from './hvscFilesystem';
import { addErrorLog, addLog } from '@/lib/logging';
import { base64ToUint8 } from '@/lib/sid/sidUtils';

// ── Utility helpers ──────────────────────────────────────────────

export const getErrorMessage = (error: unknown) => {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
        if ('message' in error) {
            const message = (error as { message?: unknown }).message;
            if (typeof message === 'string') return message;
        }
        if ('error' in error) {
            const nested = (error as { error?: unknown }).error;
            if (typeof nested === 'string') return nested;
            if (nested && typeof nested === 'object' && 'message' in nested) {
                const nestedMessage = (nested as { message?: unknown }).message;
                if (typeof nestedMessage === 'string') return nestedMessage;
            }
        }
    }
    return String(error ?? '');
};

export const isExistsError = (error: unknown) => /exists|already exists/i.test(getErrorMessage(error));

export const isTestProbeEnabled = () => {
    try {
        if (import.meta.env?.VITE_ENABLE_TEST_PROBES === '1') return true;
    } catch (error) {
        addLog('warn', 'Failed to read test probe flag', {
            error: (error as Error).message,
        });
    }
    return typeof process !== 'undefined' && process.env?.VITE_ENABLE_TEST_PROBES === '1';
};

export const shouldUseNativeDownload = () => {
    if (isTestProbeEnabled()) return false;
    try {
        return Capacitor.isNativePlatform();
    } catch (error) {
        addLog('warn', 'Failed to detect native platform for HVSC download', {
            error: (error as Error).message,
        });
        return false;
    }
};

export const parseContentLength = (value: string | null) => {
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
};

export const fetchContentLength = async (url: string) => {
    if (typeof fetch === 'undefined') return null;
    try {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (!response.ok) return null;
        return parseContentLength(response.headers.get('content-length'));
    } catch (error) {
        addLog('warn', 'Failed to read HVSC content length', {
            url,
            error: (error as Error).message,
        });
        return null;
    }
};

export const concatChunks = (chunks: Uint8Array[], totalLength?: number | null) => {
    const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
        buffer.set(chunk, offset);
        offset += chunk.length;
    });
    return buffer;
};

const readHeapUsageBytes = () => {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
        const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } };
        return perf.memory?.usedJSHeapSize ?? null;
    }
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
        return process.memoryUsage().heapUsed;
    }
    return null;
};

// ── Path normalization helpers ───────────────────────────────────

export const normalizeEntryName = (raw: string) => raw.replace(/\\/g, '/').replace(/^\/+/, '');

export const normalizeVirtualPath = (entryName: string) => {
    const name = normalizeEntryName(entryName)
        .replace(/^HVSC\//i, '')
        .replace(/^C64Music\//i, '')
        .replace(/^C64MUSIC\//i, '');
    return name.toLowerCase().endsWith('.sid') ? `/${name.replace(/^\/+/, '')}` : null;
};

export const normalizeLibraryPath = (entryName: string) => {
    const name = normalizeEntryName(entryName)
        .replace(/^HVSC\//i, '')
        .replace(/^C64Music\//i, '')
        .replace(/^C64MUSIC\//i, '')
        .replace(/^\/+/, '');
    return name ? `/${name}` : null;
};

const stripHvscRoot = (entryName: string) =>
    normalizeEntryName(entryName)
        .replace(/^HVSC\//i, '')
        .replace(/^C64Music\//i, '')
        .replace(/^C64MUSIC\//i, '');

export const normalizeUpdateVirtualPath = (entryName: string) => {
    const stripped = stripHvscRoot(entryName);
    const lowered = stripped.toLowerCase();
    const base = lowered.startsWith('new/')
        ? stripped.substring(4)
        : lowered.startsWith('update/')
            ? stripped.substring(7)
            : lowered.startsWith('updated/')
                ? stripped.substring(8)
                : stripped;
    return normalizeVirtualPath(base);
};

export const normalizeUpdateLibraryPath = (entryName: string) => {
    const stripped = stripHvscRoot(entryName);
    const lowered = stripped.toLowerCase();
    const base = lowered.startsWith('new/')
        ? stripped.substring(4)
        : lowered.startsWith('update/')
            ? stripped.substring(7)
            : lowered.startsWith('updated/')
                ? stripped.substring(8)
                : stripped;
    return normalizeLibraryPath(base);
};

export const isDeletionList = (path: string) => {
    const lowered = path.toLowerCase();
    return lowered.endsWith('.txt') && (lowered.includes('delete') || lowered.includes('remove'));
};

export const parseDeletionList = (content: string) =>
    content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && line.toLowerCase().endsWith('.sid'))
        .map((line) => (line.startsWith('/') ? line : `/${line}`));

export const parseCachedVersion = (prefix: string, name: string) => {
    const match = new RegExp(`^${prefix}-(\\d+)(\\..+)?$`, 'i').exec(name);
    return match ? Number(match[1]) : null;
};

// ── Download progress emission ───────────────────────────────────

export const emitDownloadProgress = (
    emitProgress: (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => void,
    archiveName: string,
    downloadedBytes?: number | null,
    totalBytes?: number | null,
) => {
    emitProgress({
        stage: 'download',
        message: `Downloading ${archiveName}…`,
        archiveName,
        downloadedBytes: downloadedBytes ?? undefined,
        totalBytes: totalBytes ?? undefined,
        percent: totalBytes ? Math.round(((downloadedBytes ?? 0) / totalBytes) * 100) : undefined,
    });
};

// ── Cache resolution ─────────────────────────────────────────────

export const resolveCachedArchive = async (prefix: string, version: number) => {
    const cacheDir = getHvscCacheDir();
    const candidates = [
        `${prefix}-${version}`,
        `${prefix}-${version}.7z`,
        `${prefix}-${version}.zip`,
    ];
    for (const name of candidates) {
        try {
            const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${name}` });
            if (stat.type === 'file' || stat.type === 'directory') {
                const marker = await readCachedArchiveMarker(name);
                if (marker) return name;
                await deleteCachedArchive(name);
            }
        } catch (error) {
            addLog('warn', 'HVSC cache stat failed', {
                name,
                error: (error as Error).message,
            });
        }
    }
    return null;
};

export const getCacheStatusInternal = async () => {
    const cacheDir = getHvscCacheDir();
    let files: Array<string | { name?: string }> = [];
    try {
        const result = await Filesystem.readdir({ directory: Directory.Data, path: cacheDir });
        files = result.files ?? [];
    } catch (error) {
        addLog('warn', 'HVSC cache directory read failed', {
            cacheDir,
            error: (error as Error).message,
        });
        return { baselineVersion: null, updateVersions: [] as number[] };
    }
    const names = files.map((entry) => (typeof entry === 'string' ? entry : entry.name ?? '')).filter(Boolean);
    const markerNames = names.filter((name) => name.endsWith('.complete.json'));
    const normalizeMarker = (name: string) => name.replace(/\.complete\.json$/i, '');
    const baselineVersions = markerNames
        .map((name) => parseCachedVersion('hvsc-baseline', normalizeMarker(name)))
        .filter((v): v is number => !!v);
    const updateVersions = markerNames
        .map((name) => parseCachedVersion('hvsc-update', normalizeMarker(name)))
        .filter((v): v is number => !!v);
    return {
        baselineVersion: baselineVersions.length ? Math.max(...baselineVersions) : null,
        updateVersions: Array.from(new Set(updateVersions)).sort((a, b) => a - b),
    };
};

// ── Archive read-back ────────────────────────────────────────────

export const readArchiveBuffer = async (archivePath: string) => {
    const heapBefore = readHeapUsageBytes();
    const cacheDir = getHvscCacheDir();
    const archiveData = await Filesystem.readFile({
        directory: Directory.Data,
        path: `${cacheDir}/${archivePath}`,
    });
    const decoded = base64ToUint8(archiveData.data);
    const heapAfter = readHeapUsageBytes();
    addLog('info', 'HVSC archive read memory profile', {
        archivePath,
        bytes: decoded.byteLength,
        heapBefore,
        heapAfter,
        heapDelta: (heapBefore !== null && heapAfter !== null) ? heapAfter - heapBefore : null,
    });
    return decoded;
};

// ── Download engine ──────────────────────────────────────────────

export type DownloadArchiveOptions = {
    plan: { type: 'baseline' | 'update'; version: number };
    archiveName: string;
    archivePath: string;
    downloadUrl: string;
    cancelToken: string;
    cancelTokens: Map<string, { cancelled: boolean }>;
    emitProgress: (event: Omit<HvscProgressEvent, 'ingestionId' | 'elapsedTimeMs'>) => void;
};

export const ensureNotCancelledWith = (
    cancelTokens: Map<string, { cancelled: boolean }>,
    token?: string,
    stateUpdater?: (patch: Record<string, unknown>) => void,
) => {
    if (!token) return;
    if (cancelTokens.get(token)?.cancelled) {
        stateUpdater?.({ ingestionState: 'idle', ingestionError: 'Cancelled' });
        throw new Error('HVSC update cancelled');
    }
};

export const downloadArchive = async (options: DownloadArchiveOptions): Promise<Uint8Array | null> => {
    const { plan, archiveName, archivePath, downloadUrl, cancelToken, cancelTokens, emitProgress } = options;
    const ensureNotCancelled = () => ensureNotCancelledWith(cancelTokens, cancelToken);
    let inMemoryBuffer: Uint8Array | null = null;

    ensureNotCancelled();
    emitProgress({ stage: 'download', message: `Downloading ${archiveName}…`, archiveName, percent: 0 });
    await deleteCachedArchive(archivePath);
    addLog('info', 'HVSC download started', { archiveName, url: downloadUrl });
    const downloadHeapBefore = readHeapUsageBytes();
    const totalBytesHint = await fetchContentLength(downloadUrl);

    if (shouldUseNativeDownload()) {
        const cacheDir = getHvscCacheDir();
        let lastReported = 0;
        let pollingTimer: ReturnType<typeof setInterval> | null = null;
        let totalBytes = totalBytesHint ?? null;
        let pollErrorLogged = false;
        const pollSize = async () => {
            try {
                const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
                const size = stat.size ?? 0;
                if (size > lastReported) {
                    lastReported = size;
                    emitDownloadProgress(emitProgress, archiveName, size, totalBytes);
                }
            } catch (error) {
                if (!pollErrorLogged) {
                    pollErrorLogged = true;
                    addLog('warn', 'HVSC download progress stat failed', {
                        archivePath,
                        error: (error as Error).message,
                    });
                }
            }
        };
        try {
            pollingTimer = setInterval(pollSize, 400);
            await Filesystem.downloadFile({
                url: downloadUrl,
                directory: Directory.Data,
                path: `${cacheDir}/${archivePath}`,
                progress: (status) => {
                    totalBytes = status.total ?? totalBytes;
                    const loaded = status.loaded ?? 0;
                    if (loaded >= lastReported) {
                        lastReported = loaded;
                        emitDownloadProgress(emitProgress, archiveName, loaded, totalBytes);
                    }
                },
            });
            ensureNotCancelled();
        } catch (error) {
            await deleteCachedArchive(archivePath);
            if (!isExistsError(error)) throw error;
            ensureNotCancelled();
            const response = await fetch(downloadUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Download failed: ${response.status} ${response.statusText}`);
            }
            const buffer = new Uint8Array(await response.arrayBuffer());
            await writeCachedArchive(archivePath, buffer);
            emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, buffer.byteLength);
            inMemoryBuffer = buffer;
        } finally {
            if (pollingTimer) clearInterval(pollingTimer);
        }
    } else {
        ensureNotCancelled();
        const response = await fetch(downloadUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }
        const totalBytes = parseContentLength(response.headers.get('content-length')) ?? totalBytesHint;
        if (!response.body) {
            const buffer = new Uint8Array(await response.arrayBuffer());
            if (totalBytes && buffer.byteLength !== totalBytes) {
                throw new Error(`Download size mismatch: expected ${totalBytes}, got ${buffer.byteLength}`);
            }
            await writeCachedArchive(archivePath, buffer);
            emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, buffer.byteLength);
            inMemoryBuffer = buffer;
        } else {
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let loaded = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    chunks.push(value);
                    loaded += value.length;
                    emitDownloadProgress(emitProgress, archiveName, loaded, totalBytes ?? null);
                }
                ensureNotCancelled();
            }
            if (totalBytes && loaded !== totalBytes) {
                throw new Error(`Download size mismatch: expected ${totalBytes}, got ${loaded}`);
            }
            const buffer = concatChunks(chunks, totalBytes ?? undefined);
            await writeCachedArchive(archivePath, buffer);
            emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, totalBytes ?? buffer.byteLength);
            inMemoryBuffer = buffer;
        }
    }

    const downloadHeapAfter = readHeapUsageBytes();
    addLog('info', 'HVSC download memory profile', {
        archiveName,
        heapBefore: downloadHeapBefore,
        heapAfter: downloadHeapAfter,
        heapDelta: (downloadHeapBefore !== null && downloadHeapAfter !== null)
            ? downloadHeapAfter - downloadHeapBefore
            : null,
    });

    addLog('info', 'HVSC download completed', { archiveName });

    const cacheDir = getHvscCacheDir();
    try {
        const stat = await Filesystem.stat({ directory: Directory.Data, path: `${cacheDir}/${archivePath}` });
        await writeCachedArchiveMarker(archivePath, {
            version: plan.version,
            type: plan.type,
            sizeBytes: stat.size,
            completedAt: new Date().toISOString(),
        });
        emitProgress({
            stage: 'download',
            message: `Downloaded ${archiveName}`,
            archiveName,
            downloadedBytes: stat.size,
            totalBytes: stat.size,
            percent: 100,
        });
    } catch (error) {
        addLog('warn', 'Failed to write HVSC cache marker', {
            archivePath,
            error: (error as Error).message,
        });
        await writeCachedArchiveMarker(archivePath, {
            version: plan.version,
            type: plan.type,
            sizeBytes: null,
            completedAt: new Date().toISOString(),
        });
    }

    return inMemoryBuffer;
};
