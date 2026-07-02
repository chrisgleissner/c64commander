/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { buildBinaryFingerprint } from "@/lib/binaryFingerprint";
import type { C64API } from "@/lib/c64api";
import { FolderPicker } from "@/lib/native/folderPicker";
import { getFileExtension } from "@/lib/playback/fileTypes";
import { fetchUltimateOriginBlob, isOriginOnSelectedDevice } from "@/lib/savedDevices/deviceBoundOrigin";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import {
  getLocalSourceListingMode,
  getLocalSourceRuntimeFile,
  loadLocalSources,
  requireLocalSourceEntries,
  type LocalSourceRecord,
} from "@/lib/sourceNavigation/localSourcesStore";
import type { DiskEntry } from "./diskTypes";

const MAX_LOCAL_DISK_IMAGE_BYTES = 64 * 1024 * 1024;
const LOCAL_DISK_READ_TIMEOUT_BASE_MS = 8000;
const LOCAL_DISK_READ_TIMEOUT_PER_MIB_MS = 500;
const LOCAL_DISK_READ_TIMEOUT_MAX_MS = 45000;
const LOCAL_DISK_READ_TIMEOUT_UNKNOWN_MS = 15000;
const LOCAL_DISK_BASE64_CHUNK_CHARS = 256 * 1024;
const LOCAL_DISK_DECODE_YIELD_BYTES = 1024 * 1024;

type ResolveLocalDiskBlobOptions = {
  signal?: AbortSignal;
};

type MountDiskToDriveOptions = {
  mode?: "readwrite" | "readonly" | "unlinked";
};

const createAbortError = (context: string) => {
  if (typeof DOMException !== "undefined") {
    return new DOMException(`${context} cancelled`, "AbortError");
  }
  const error = new Error(`${context} cancelled`);
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal: AbortSignal | undefined, context: string) => {
  if (signal?.aborted) {
    throw createAbortError(context);
  }
};

const estimateBase64DecodedBytes = (base64: string) => {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

const validateLocalDiskPayloadSize = (base64: string, context: string) => {
  const estimatedBytes = estimateBase64DecodedBytes(base64);
  if (estimatedBytes > MAX_LOCAL_DISK_IMAGE_BYTES) {
    throw new Error(`${context} is too large to mount (${estimatedBytes} bytes).`);
  }
  return estimatedBytes;
};

const waitForDecodeYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const base64ToUint8 = async (base64: string, signal: AbortSignal | undefined, context: string) => {
  const expectedBytes = estimateBase64DecodedBytes(base64);
  const bytes = new Uint8Array(expectedBytes);
  let outputOffset = 0;
  let bytesSinceYield = 0;

  for (let offset = 0; offset < base64.length; offset += LOCAL_DISK_BASE64_CHUNK_CHARS) {
    throwIfAborted(signal, context);
    const chunk = base64.slice(offset, offset + LOCAL_DISK_BASE64_CHUNK_CHARS);
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[outputOffset] = binary.charCodeAt(i);
      outputOffset += 1;
    }
    bytesSinceYield += binary.length;
    if (bytesSinceYield >= LOCAL_DISK_DECODE_YIELD_BYTES && offset + LOCAL_DISK_BASE64_CHUNK_CHARS < base64.length) {
      bytesSinceYield = 0;
      await waitForDecodeYield();
    }
  }

  return outputOffset === bytes.byteLength ? bytes : bytes.slice(0, outputOffset);
};

const decodeLocalDiskPayload = async (base64: string, context: string, signal?: AbortSignal) => {
  validateLocalDiskPayloadSize(base64, context);
  throwIfAborted(signal, context);
  const bytes = await base64ToUint8(base64, signal, context);
  if (bytes.byteLength > MAX_LOCAL_DISK_IMAGE_BYTES) {
    throw new Error(`${context} is too large to mount (${bytes.byteLength} bytes).`);
  }
  throwIfAborted(signal, context);
  return bytes;
};

const buildLocalDiskReadTimeoutMs = (sizeBytes?: number | null) => {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return LOCAL_DISK_READ_TIMEOUT_UNKNOWN_MS;
  }
  const mib = Math.ceil(sizeBytes / (1024 * 1024));
  return Math.min(
    LOCAL_DISK_READ_TIMEOUT_MAX_MS,
    Math.max(
      LOCAL_DISK_READ_TIMEOUT_BASE_MS,
      LOCAL_DISK_READ_TIMEOUT_BASE_MS + mib * LOCAL_DISK_READ_TIMEOUT_PER_MIB_MS,
    ),
  );
};

const createReadTimeoutError = (context: string, timeoutMs: number) => {
  const error = new Error(`${context} timed out after ${timeoutMs} ms`);
  error.name = "TimeoutError";
  return error;
};

const isDefinitiveLocalDiskReadFailure = (error: unknown) => {
  const candidate = error as Error | undefined;
  if (!candidate) return false;
  if (candidate.name === "TimeoutError" || candidate.name === "AbortError") return true;
  return /too large to mount/i.test(candidate.message);
};

export const buildDiskMountType = (path: string) => {
  const ext = getFileExtension(path);
  return ext || undefined;
};

const logResolvedLocalDiskBytes = (disk: DiskEntry, source: string, bytes: Uint8Array) => {
  addLog("debug", "Local disk bytes resolved", {
    path: disk.path,
    location: disk.location,
    sourceId: disk.sourceId ?? null,
    localUri: disk.localUri ?? null,
    localTreeUri: disk.localTreeUri ?? null,
    resolutionSource: source,
    fingerprint: buildBinaryFingerprint(bytes),
  });
};

export const resolveLocalDiskBlob = async (
  disk: DiskEntry,
  runtimeFile?: File,
  options: ResolveLocalDiskBlobOptions = {},
): Promise<Blob> => {
  const { signal } = options;
  const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, context: string) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(createReadTimeoutError(context, timeoutMs)), timeoutMs);
    });
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          abortHandler = () => reject(createAbortError(context));
          signal.addEventListener("abort", abortHandler, { once: true });
        })
      : null;
    try {
      throwIfAborted(signal, context);
      const raced = abortPromise
        ? Promise.race([promise, timeoutPromise, abortPromise])
        : Promise.race([promise, timeoutPromise]);
      const result = await raced;
      throwIfAborted(signal, context);
      return result;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  };

  if (runtimeFile) {
    throwIfAborted(signal, "Local disk runtime file read");
    if (runtimeFile.size > MAX_LOCAL_DISK_IMAGE_BYTES) {
      throw new Error(`Local disk runtime file is too large to mount (${runtimeFile.size} bytes).`);
    }
    const bytes = new Uint8Array(await runtimeFile.arrayBuffer());
    throwIfAborted(signal, "Local disk runtime file read");
    logResolvedLocalDiskBytes(disk, "runtime-file", bytes);
    return runtimeFile;
  }
  if (disk.localUri) {
    const data = await withTimeout(
      FolderPicker.readFile({ uri: disk.localUri }),
      buildLocalDiskReadTimeoutMs(disk.sizeBytes),
      "Local disk file read",
    );
    const bytes = await decodeLocalDiskPayload(data.data, "Local disk file read", signal);
    logResolvedLocalDiskBytes(disk, "local-uri", bytes);
    return new Blob([bytes], {
      type: "application/octet-stream",
    });
  }
  if (disk.localTreeUri) {
    const data = await withTimeout(
      FolderPicker.readFileFromTree({
        treeUri: disk.localTreeUri,
        path: disk.path,
      }),
      buildLocalDiskReadTimeoutMs(disk.sizeBytes),
      "Local disk tree read",
    );
    const bytes = await decodeLocalDiskPayload(data.data, "Local disk tree read", signal);
    logResolvedLocalDiskBytes(disk, "disk.localTreeUri", bytes);
    return new Blob([bytes], {
      type: "application/octet-stream",
    });
  }
  const normalizedPath = normalizeSourcePath(disk.path);
  const sources = loadLocalSources();

  const resolveFromSource = async (source: LocalSourceRecord): Promise<Blob | null> => {
    const runtime = getLocalSourceRuntimeFile(source.id, normalizedPath);
    if (runtime) return runtime;
    if (source.android?.treeUri) {
      try {
        const data = await withTimeout(
          FolderPicker.readFileFromTree({
            treeUri: source.android.treeUri,
            path: normalizedPath,
          }),
          buildLocalDiskReadTimeoutMs(disk.sizeBytes),
          "Local disk tree read",
        );
        const bytes = await decodeLocalDiskPayload(data.data, "Local disk tree read", signal);
        logResolvedLocalDiskBytes(disk, `source-tree:${source.id}`, bytes);
        return new Blob([bytes], {
          type: "application/octet-stream",
        });
      } catch (error) {
        addErrorLog("Local disk tree read failed", {
          sourceId: source.id,
          normalizedPath,
          error: (error as Error).message,
        });
        if (isDefinitiveLocalDiskReadFailure(error)) {
          throw error;
        }
        return null;
      }
    }
    if (getLocalSourceListingMode(source) === "entries") {
      try {
        const entries = requireLocalSourceEntries(source, "diskMount.resolveLocalDiskBlob");
        const match = entries.find((entry) => normalizeSourcePath(entry.relativePath) === normalizedPath);
        if (match?.uri) {
          const data = await withTimeout(
            FolderPicker.readFile({ uri: match.uri }),
            buildLocalDiskReadTimeoutMs(match.sizeBytes ?? disk.sizeBytes),
            "Local disk file read",
          );
          const bytes = await decodeLocalDiskPayload(data.data, "Local disk file read", signal);
          logResolvedLocalDiskBytes(disk, `source-uri:${source.id}`, bytes);
          return new Blob([bytes], {
            type: "application/octet-stream",
          });
        }
      } catch (error) {
        addErrorLog("Local source entries resolve failed", {
          path: disk.path,
          sourceId: source.id,
          diskSourceId: disk.sourceId,
          normalizedPath,
          listingMode: getLocalSourceListingMode(source),
          location: "diskMount.resolveLocalDiskBlob",
          error: (error as Error).message,
        });
        if (isDefinitiveLocalDiskReadFailure(error)) {
          throw error;
        }
        return null;
      }
    }
    return null;
  };

  if (disk.sourceId) {
    const source = sources.find((entry) => entry.id === disk.sourceId);
    if (source) {
      const blob = await resolveFromSource(source);
      if (blob) return blob;
    }
  }

  for (const source of sources) {
    const blob = await resolveFromSource(source);
    if (blob) return blob;
  }

  // A CommoServe-imported disk's bytes only ever live in the in-memory
  // runtimeFiles map (React state) - navigating away or restarting loses
  // them, and its sourceId never resolves via loadLocalSources() (CommoServe
  // is not a persisted local source). The generic "re-add the folder"
  // message is meaningless here since there is no folder/file to re-add.
  // See HARD9-011.
  if (disk.sourceKind === "commoserve") {
    throw new Error("This disk's data is no longer available. Re-import it from CommoServe to mount it again.");
  }

  throw new Error("Local disk access is missing. Re-add the folder or file to refresh permissions.");
};

export const mountDiskToDrive = async (
  api: C64API,
  drive: "a" | "b",
  disk: DiskEntry,
  runtimeFile?: File,
  options: MountDiskToDriveOptions = {},
) => {
  const mode = options.mode ?? "readwrite";
  try {
    const mountType = buildDiskMountType(disk.path);
    if (!mountType) {
      throw new Error("Unsupported disk image type.");
    }
    addLog("debug", "Disk mount request", {
      drive,
      path: disk.path,
      location: disk.location,
      mountType,
      baseUrl: api.getBaseUrl(),
      deviceHost: api.getDeviceHost(),
    });
    if (disk.location === "ultimate") {
      if (isOriginOnSelectedDevice(disk.origin)) {
        await api.mountDrive(drive, disk.path, mountType, mode);
      } else if (disk.origin) {
        const blob = await fetchUltimateOriginBlob(disk.origin);
        await api.mountDriveUpload(drive, blob, mountType, mode, { filename: disk.origin.originPath });
      } else {
        await api.mountDrive(drive, disk.path, mountType, mode);
      }
      return;
    }

    const blob = await resolveLocalDiskBlob(disk, runtimeFile);
    addLog("debug", "Local disk blob prepared for mount", {
      drive,
      path: disk.path,
      location: disk.location,
      sourceId: disk.sourceId ?? null,
      sizeBytes: blob.size,
    });
    await api.mountDriveUpload(drive, blob, mountType, mode, { filename: disk.path });
  } catch (error) {
    addErrorLog("Disk mount failed", {
      drive,
      path: disk.path,
      location: disk.location,
      baseUrl: api.getBaseUrl(),
      deviceHost: api.getDeviceHost(),
      endpoint: `/v1/drives/${drive}:mount`,
      error: (error as Error).message,
    });
    throw error;
  }
};
