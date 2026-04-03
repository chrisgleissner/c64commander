/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import type { HvscProgressEvent } from "./hvscTypes";
import {
  getHvscCacheDir,
  writeCachedArchive,
  deleteCachedArchive,
  writeCachedArchiveMarker,
  readCachedArchiveMarker,
  MAX_BRIDGE_READ_BYTES,
} from "./hvscFilesystem";
import { HvscIngestion } from "@/lib/native/hvscIngestion";
import { addErrorLog, addLog } from "@/lib/logging";

const HVSC_NATIVE_ARCHIVE_READ_CHUNK_BYTES = 512 * 1024;

// ── Utility helpers ──────────────────────────────────────────────

export const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    if ("error" in error) {
      const nested = (error as { error?: unknown }).error;
      if (typeof nested === "string") return nested;
      if (nested && typeof nested === "object" && "message" in nested) {
        const nestedMessage = (nested as { message?: unknown }).message;
        if (typeof nestedMessage === "string") return nestedMessage;
      }
    }
  }
  return String(error ?? "");
};

export const isExistsError = (error: unknown) => /exists|already exists/i.test(getErrorMessage(error));

export const isTestProbeEnabled = () => {
  try {
    if (import.meta.env?.VITE_ENABLE_TEST_PROBES === "1") return true;
  } catch (error) {
    addLog("warn", "Failed to read test probe flag", {
      error: (error as Error).message,
    });
  }
  return typeof process !== "undefined" && process.env?.VITE_ENABLE_TEST_PROBES === "1";
};

export const shouldUseNativeDownload = () => {
  if (isTestProbeEnabled()) return false;
  try {
    return Capacitor.isNativePlatform();
  } catch (error) {
    addLog("warn", "Failed to detect native platform for HVSC download", {
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
  if (typeof fetch === "undefined") return null;
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!response.ok) return null;
    return parseContentLength(response.headers.get("content-length"));
  } catch (error) {
    addLog("warn", "Failed to read HVSC content length", {
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
  if (typeof performance !== "undefined" && "memory" in performance) {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    };
    return perf.memory?.usedJSHeapSize ?? null;
  }
  if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
    return process.memoryUsage().heapUsed;
  }
  return null;
};

const decodeBase64ToUint8Chunked = (base64: string) => {
  const normalized = base64.replace(/\s+/g, "");
  if (!normalized) {
    return new Uint8Array();
  }
  const stripped = normalized.replace(/=+$/, "");
  const outputLength = Math.floor((stripped.length * 3) / 4);
  const output = new Uint8Array(outputLength);
  const encodedChunkLength = 16384;
  const safeChunkLength = encodedChunkLength - (encodedChunkLength % 4);

  let offset = 0;
  for (let index = 0; index < normalized.length; index += safeChunkLength) {
    const chunk = normalized.slice(index, index + safeChunkLength);
    if (!chunk) continue;
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i += 1) {
      if (offset >= output.length) break;
      output[offset] = binary.charCodeAt(i);
      offset += 1;
    }
  }
  return output;
};

const streamToBuffer = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  totalBytes: number | null,
  ensureNotCancelled: () => void,
  onProgress: (downloadedBytes: number) => void,
) => {
  let loaded = 0;

  if (totalBytes && totalBytes > 0) {
    const boundedBuffer = new Uint8Array(totalBytes);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      boundedBuffer.set(value, loaded);
      loaded += value.length;
      onProgress(loaded);
      ensureNotCancelled();
    }
    if (loaded !== totalBytes) {
      throw new Error(`Download size mismatch: expected ${totalBytes}, got ${loaded}`);
    }
    return boundedBuffer;
  }

  let capacity = 64 * 1024;
  let dynamicBuffer = new Uint8Array(capacity);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const required = loaded + value.length;
    if (required > capacity) {
      while (capacity < required) {
        capacity *= 2;
      }
      const expanded = new Uint8Array(capacity);
      expanded.set(dynamicBuffer.subarray(0, loaded), 0);
      dynamicBuffer = expanded;
    }
    dynamicBuffer.set(value, loaded);
    loaded += value.length;
    onProgress(loaded);
    ensureNotCancelled();
  }

  return dynamicBuffer.subarray(0, loaded);
};

// ── Path normalization helpers ───────────────────────────────────

export const normalizeEntryName = (raw: string) => raw.replace(/\\/g, "/").replace(/^\/+/, "");

export const normalizeVirtualPath = (entryName: string) => {
  const name = normalizeEntryName(entryName)
    .replace(/^HVSC\//i, "")
    .replace(/^C64Music\//i, "")
    .replace(/^C64MUSIC\//i, "");
  return name.toLowerCase().endsWith(".sid") ? `/${name.replace(/^\/+/, "")}` : null;
};

export const normalizeLibraryPath = (entryName: string) => {
  const name = normalizeEntryName(entryName)
    .replace(/^HVSC\//i, "")
    .replace(/^C64Music\//i, "")
    .replace(/^C64MUSIC\//i, "")
    .replace(/^\/+/, "");
  return name ? `/${name}` : null;
};

const stripHvscRoot = (entryName: string) =>
  normalizeEntryName(entryName)
    .replace(/^HVSC\//i, "")
    .replace(/^C64Music\//i, "")
    .replace(/^C64MUSIC\//i, "");

export const normalizeUpdateVirtualPath = (entryName: string) => {
  const stripped = stripHvscRoot(entryName);
  const lowered = stripped.toLowerCase();
  const base = lowered.startsWith("new/")
    ? stripped.substring(4)
    : lowered.startsWith("update/")
      ? stripped.substring(7)
      : lowered.startsWith("updated/")
        ? stripped.substring(8)
        : stripped;
  return normalizeVirtualPath(base);
};

export const normalizeUpdateLibraryPath = (entryName: string) => {
  const stripped = stripHvscRoot(entryName);
  const lowered = stripped.toLowerCase();
  const base = lowered.startsWith("new/")
    ? stripped.substring(4)
    : lowered.startsWith("update/")
      ? stripped.substring(7)
      : lowered.startsWith("updated/")
        ? stripped.substring(8)
        : stripped;
  return normalizeLibraryPath(base);
};

export const isDeletionList = (path: string) => {
  const lowered = path.toLowerCase();
  return lowered.endsWith(".txt") && (lowered.includes("delete") || lowered.includes("remove"));
};

export const parseDeletionList = (content: string) =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.toLowerCase().endsWith(".sid"))
    .map((line) => (line.startsWith("/") ? line : `/${line}`));

export const parseCachedVersion = (prefix: string, name: string) => {
  const match = new RegExp(`^${prefix}-(\\d+)(\\..+)?$`, "i").exec(name);
  return match ? Number(match[1]) : null;
};

// ── Download progress emission ───────────────────────────────────

export const emitDownloadProgress = (
  emitProgress: (event: Omit<HvscProgressEvent, "ingestionId" | "elapsedTimeMs">) => void,
  archiveName: string,
  downloadedBytes?: number | null,
  totalBytes?: number | null,
) => {
  emitProgress({
    stage: "download",
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
  const candidates = [`${prefix}-${version}`, `${prefix}-${version}.7z`, `${prefix}-${version}.zip`];
  for (const name of candidates) {
    try {
      const stat = await Filesystem.stat({
        directory: Directory.Data,
        path: `${cacheDir}/${name}`,
      });
      if (stat.type === "file" || stat.type === "directory") {
        const marker = await readCachedArchiveMarker(name);
        const statSize = stat.size ?? null;
        const hasSizeMismatch =
          typeof marker?.sizeBytes === "number" &&
          marker.sizeBytes > 0 &&
          statSize !== null &&
          statSize !== marker.sizeBytes;
        const violatesExpectedSize =
          typeof marker?.expectedSizeBytes === "number" &&
          marker.expectedSizeBytes > 0 &&
          statSize !== null &&
          statSize < marker.expectedSizeBytes * 0.99;
        if (marker && !hasSizeMismatch && !violatesExpectedSize) return name;
        if (marker && (hasSizeMismatch || violatesExpectedSize)) {
          addLog("warn", "HVSC cached archive marker validation failed", {
            name,
            statSize,
            markerSizeBytes: marker.sizeBytes ?? null,
            markerExpectedSizeBytes: marker.expectedSizeBytes ?? null,
          });
        }
        await deleteCachedArchive(name);
      }
    } catch (error) {
      addLog("warn", "HVSC cache stat failed", {
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
    const result = await Filesystem.readdir({
      directory: Directory.Data,
      path: cacheDir,
    });
    files = result.files ?? [];
  } catch (error) {
    addLog("warn", "HVSC cache directory read failed", {
      cacheDir,
      error: (error as Error).message,
    });
    return { baselineVersion: null, updateVersions: [] as number[] };
  }
  const names = files.map((entry) => (typeof entry === "string" ? entry : (entry.name ?? ""))).filter(Boolean);
  const markerNames = names.filter((name) => name.endsWith(".complete.json"));
  const normalizeMarker = (name: string) => name.replace(/\.complete\.json$/i, "");
  const baselineVersions = markerNames
    .map((name) => parseCachedVersion("hvsc-baseline", normalizeMarker(name)))
    .filter((v): v is number => !!v);
  const updateVersions = markerNames
    .map((name) => parseCachedVersion("hvsc-update", normalizeMarker(name)))
    .filter((v): v is number => !!v);
  return {
    baselineVersion: baselineVersions.length ? Math.max(...baselineVersions) : null,
    updateVersions: Array.from(new Set(updateVersions)).sort((a, b) => a - b),
  };
};

// ── Archive read-back ────────────────────────────────────────────

const buildNonNativeLargeArchiveError = (archiveName: string, sizeBytes: number) =>
  `HVSC non-native archive handling is limited to ${MAX_BRIDGE_READ_BYTES} bytes. ` +
  `${archiveName} is ${sizeBytes} bytes and requires the native ingestion plugin on this platform.`;

export const readArchiveBuffer = async (archivePath: string) => {
  const heapBefore = readHeapUsageBytes();
  const cacheDir = getHvscCacheDir();
  const relativeArchivePath = `${cacheDir}/${archivePath}`;
  let statSize: number | null = null;
  try {
    const stat = await Filesystem.stat({
      directory: Directory.Data,
      path: relativeArchivePath,
    });
    statSize = stat?.size ?? null;
  } catch (error) {
    addLog("warn", "Failed to stat archive before guarded read", {
      archivePath,
      error: (error as Error).message,
    });
  }
  if (statSize !== null && statSize > MAX_BRIDGE_READ_BYTES) {
    if (shouldUseNativeDownload()) {
      const chunks: Uint8Array[] = [];
      let offsetBytes = 0;
      let decodedBytes = 0;
      while (offsetBytes < statSize) {
        const chunk = await HvscIngestion.readArchiveChunk({
          relativeArchivePath,
          offsetBytes,
          lengthBytes: Math.min(HVSC_NATIVE_ARCHIVE_READ_CHUNK_BYTES, statSize - offsetBytes),
        });
        if (chunk.sizeBytes <= 0) break;
        const decodedChunk = decodeBase64ToUint8Chunked(chunk.data);
        if (decodedChunk.byteLength !== chunk.sizeBytes) {
          throw new Error(
            `HVSC native chunk size mismatch for ${archivePath}: decoded ${decodedChunk.byteLength} bytes, expected ${chunk.sizeBytes}`,
          );
        }
        chunks.push(decodedChunk);
        offsetBytes += chunk.sizeBytes;
        decodedBytes += decodedChunk.byteLength;
        if (chunk.eof) break;
      }
      if (decodedBytes !== statSize) {
        throw new Error(
          `HVSC native chunk read incomplete for ${archivePath}: expected ${statSize} bytes, received ${decodedBytes}`,
        );
      }
      const decoded = concatChunks(chunks, decodedBytes);
      const heapAfter = readHeapUsageBytes();
      addLog("info", "HVSC archive read via native chunk bridge", {
        archivePath,
        bytes: decoded.byteLength,
        chunks: chunks.length,
        heapBefore,
        heapAfter,
        heapDelta: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
      });
      return decoded;
    }
    throw new Error(buildNonNativeLargeArchiveError(archivePath, statSize));
  }
  const archiveData = await Filesystem.readFile({
    directory: Directory.Data,
    path: relativeArchivePath,
  });
  const decoded = decodeBase64ToUint8Chunked(archiveData.data);
  const heapAfter = readHeapUsageBytes();
  addLog("info", "HVSC archive read memory profile", {
    archivePath,
    bytes: decoded.byteLength,
    heapBefore,
    heapAfter,
    heapDelta: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
  });
  return decoded;
};

// ── Download engine ──────────────────────────────────────────────

export type DownloadArchiveOptions = {
  plan: { type: "baseline" | "update"; version: number };
  archiveName: string;
  archivePath: string;
  downloadUrl: string;
  cancelToken: string;
  cancelTokens: Map<string, { cancelled: boolean }>;
  emitProgress: (event: Omit<HvscProgressEvent, "ingestionId" | "elapsedTimeMs">) => void;
  retainInMemoryBuffer?: boolean;
};

export const ensureNotCancelledWith = (
  cancelTokens: Map<string, { cancelled: boolean }>,
  token?: string,
  stateUpdater?: (patch: Record<string, unknown>) => void,
) => {
  if (!token) return;
  if (cancelTokens.get(token)?.cancelled) {
    stateUpdater?.({ ingestionState: "idle", ingestionError: "Cancelled" });
    throw new Error("HVSC update cancelled");
  }
};

export const downloadArchive = async (options: DownloadArchiveOptions): Promise<Uint8Array | null> => {
  const { plan, archiveName, archivePath, downloadUrl, cancelToken, cancelTokens, emitProgress } = options;
  const retainInMemoryBuffer = options.retainInMemoryBuffer ?? false;
  const ensureNotCancelled = () => ensureNotCancelledWith(cancelTokens, cancelToken);
  let inMemoryBuffer: Uint8Array | null = null;
  let expectedSizeBytes: number | null = null;

  ensureNotCancelled();
  emitProgress({
    stage: "download",
    message: `Downloading ${archiveName}…`,
    archiveName,
    percent: 0,
  });
  await deleteCachedArchive(archivePath);
  addLog("info", "HVSC download started", { archiveName, url: downloadUrl });
  const downloadHeapBefore = readHeapUsageBytes();
  const totalBytesHint = await fetchContentLength(downloadUrl);
  expectedSizeBytes = totalBytesHint;
  if (!shouldUseNativeDownload() && totalBytesHint !== null && totalBytesHint > MAX_BRIDGE_READ_BYTES) {
    throw new Error(buildNonNativeLargeArchiveError(archiveName, totalBytesHint));
  }

  if (shouldUseNativeDownload()) {
    const cacheDir = getHvscCacheDir();
    let lastReported = 0;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let totalBytes = totalBytesHint ?? null;
    let pollErrorLogged = false;
    const pollSize = async () => {
      try {
        const stat = await Filesystem.stat({
          directory: Directory.Data,
          path: `${cacheDir}/${archivePath}`,
        });
        const size = stat.size ?? 0;
        if (size > lastReported) {
          lastReported = size;
          emitDownloadProgress(emitProgress, archiveName, size, totalBytes);
        }
      } catch (error) {
        if (!pollErrorLogged) {
          pollErrorLogged = true;
          addLog("warn", "HVSC download progress stat failed", {
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
          expectedSizeBytes = status.total ?? expectedSizeBytes;
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
      const response = await fetch(downloadUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      await writeCachedArchive(archivePath, buffer);
      emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, buffer.byteLength);
      inMemoryBuffer = retainInMemoryBuffer ? buffer : null;
    } finally {
      if (pollingTimer) clearInterval(pollingTimer);
    }
    let nativeDownloadedSize: number | null = null;
    try {
      const postStat = await Filesystem.stat({
        directory: Directory.Data,
        path: `${cacheDir}/${archivePath}`,
      });
      nativeDownloadedSize = postStat.size ?? null;
    } catch (statError) {
      addLog("warn", "Failed to stat native download for size validation", {
        archivePath,
        error: (statError as Error).message,
      });
    }
    if (totalBytesHint && nativeDownloadedSize !== null && nativeDownloadedSize < totalBytesHint * 0.99) {
      await deleteCachedArchive(archivePath);
      throw new Error(
        `HVSC archive is corrupt or truncated: native download for "${archiveName}" wrote ${nativeDownloadedSize} bytes, expected ~${totalBytesHint}. Please re-download.`,
      );
    }
  } else {
    ensureNotCancelled();
    const response = await fetch(downloadUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const totalBytes = parseContentLength(response.headers.get("content-length")) ?? totalBytesHint;
    expectedSizeBytes = totalBytes;
    if (!response.body) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (totalBytes && buffer.byteLength !== totalBytes) {
        throw new Error(`Download size mismatch: expected ${totalBytes}, got ${buffer.byteLength}`);
      }
      await writeCachedArchive(archivePath, buffer);
      emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, buffer.byteLength);
      inMemoryBuffer = retainInMemoryBuffer ? buffer : null;
    } else {
      const reader = response.body.getReader();
      let buffer: Uint8Array;
      try {
        buffer = await streamToBuffer(reader, totalBytes, ensureNotCancelled, (loadedBytes) =>
          emitDownloadProgress(emitProgress, archiveName, loadedBytes, totalBytes ?? null),
        );
      } catch (error) {
        try {
          await reader.cancel();
        } catch (cancelError) {
          addLog("warn", "Failed to cancel HVSC download reader after stream error", {
            archiveName,
            error: (cancelError as Error).message,
          });
        }
        throw error;
      } finally {
        try {
          reader.releaseLock();
        } catch (releaseError) {
          addLog("warn", "Failed to release HVSC download reader lock", {
            archiveName,
            error: (releaseError as Error).message,
          });
        }
      }
      await writeCachedArchive(archivePath, buffer);
      emitDownloadProgress(emitProgress, archiveName, buffer.byteLength, totalBytes ?? buffer.byteLength);
      inMemoryBuffer = retainInMemoryBuffer ? buffer : null;
    }
  }

  const downloadHeapAfter = readHeapUsageBytes();
  addLog("info", "HVSC download memory profile", {
    archiveName,
    heapBefore: downloadHeapBefore,
    heapAfter: downloadHeapAfter,
    heapDelta:
      downloadHeapBefore !== null && downloadHeapAfter !== null ? downloadHeapAfter - downloadHeapBefore : null,
  });

  addLog("info", "HVSC download completed", { archiveName });

  const cacheDir = getHvscCacheDir();
  try {
    const stat = await Filesystem.stat({
      directory: Directory.Data,
      path: `${cacheDir}/${archivePath}`,
    });
    await writeCachedArchiveMarker(archivePath, {
      version: plan.version,
      type: plan.type,
      sizeBytes: stat.size,
      expectedSizeBytes,
      sourceUrl: downloadUrl,
      completedAt: new Date().toISOString(),
    });
    emitProgress({
      stage: "download",
      message: `Downloaded ${archiveName}`,
      archiveName,
      downloadedBytes: stat.size,
      totalBytes: stat.size,
      percent: 100,
    });
  } catch (error) {
    addLog("warn", "Failed to write HVSC cache marker", {
      archivePath,
      error: (error as Error).message,
    });
    await writeCachedArchiveMarker(archivePath, {
      version: plan.version,
      type: plan.type,
      sizeBytes: null,
      expectedSizeBytes,
      sourceUrl: downloadUrl,
      completedAt: new Date().toISOString(),
    });
  }

  return inMemoryBuffer;
};
