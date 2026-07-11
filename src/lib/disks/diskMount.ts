/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";
import { buildBinaryFingerprint } from "@/lib/binaryFingerprint";
import { loadDebugLoggingEnabled } from "@/lib/config/appSettings";
import type { C64API } from "@/lib/c64api";
import { createArchiveClient } from "@/lib/archive/client";
import { getCachedArchiveDiskBlob, setCachedArchiveDiskBlob } from "@/lib/archive/archiveDiskCache";
import type { ArchiveClientConfigInput, ArchivePlaylistReference } from "@/lib/archive/types";
import { FolderPicker } from "@/lib/native/folderPicker";
import { getFileExtension } from "@/lib/playback/fileTypes";
// Reused as-is: the sd/usb/flash-over-temp persistent-root ranking is
// generic storage-root selection logic, not REU-specific. See HARD18-014.
import { resolvePersistentReuStorageRoot } from "@/lib/reu/reuWorkflow";
import { uint8ToBase64 } from "@/lib/sid/sidUtils";
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
  archiveConfigs?: Record<string, ArchiveClientConfigInput>;
};

// HARD18-025: for local/archive disks, upload-mounts (mountDriveUpload) write
// to a transient device-side copy the app can never read back - in-game
// saves are silently discarded on the next mount. For writable-source disks
// (a local library entry with a writable SAF tree handle, or an archive/
// CommoServe blob staged in the in-memory disk cache) the fuller fix
// materializes the image to the device filesystem (FTP upload to a work dir
// + path-mount) so writes persist, then FTP-downloads the modified image
// back on eject and re-persists it to that same source.
export type DiskWriteBackTarget =
  | { kind: "local-tree"; treeUri: string; path: string }
  | { kind: "archive-cache"; archiveRef: ArchivePlaylistReference }
  | { kind: "unavailable" };

export type DiskMountWriteBackDependencies = {
  listRemoteStorageRoots: () => Promise<string[]>;
  writeRemoteFile: (path: string, bytes: Uint8Array) => Promise<void>;
  readRemoteFile: (path: string) => Promise<Uint8Array>;
};

export type DiskMountPersistence =
  // Ultimate-origin disk mounted by its own on-device path - writes already
  // land on that same persistent path; no work-dir involved.
  | "device-native"
  // Local/archive disk materialized to a device work-dir path-mount; eject
  // will FTP-download it back and re-persist to writeBackTarget.
  | "materialized"
  // Buffer-mounted (mountDriveUpload); any device-side writes are lost on
  // the next mount. writeBackTarget explains why materialization didn't run.
  | "transient";

export type DiskMountOutcome = {
  persistence: DiskMountPersistence;
  writeBackTarget?: DiskWriteBackTarget;
  workPath?: string;
};

type MountDiskToDriveOptions = {
  mode?: "readwrite" | "readonly" | "unlinked";
  archiveConfigs?: Record<string, ArchiveClientConfigInput>;
  writeBack?: DiskMountWriteBackDependencies;
};

const DISK_WORK_DIR_NAME = "c64commander-disk-work";

// resolveLocalDiskBlob's own resolution order, mirrored here to find the
// SAME writable handle it read bytes from (not just "some source with this
// path") - a disk with no tree-backed source has no write-back primitive.
export const resolveDiskWriteBackTarget = (disk: DiskEntry): DiskWriteBackTarget => {
  if (disk.location === "ultimate") {
    // Already persistent via its own on-device path; not this mechanism's concern.
    return { kind: "unavailable" };
  }
  if (disk.localTreeUri) {
    return { kind: "local-tree", treeUri: disk.localTreeUri, path: disk.path };
  }
  // archiveRef is checked before sourceId, mirroring resolveLocalDiskBlob:
  // a CommoServe disk's sourceId never resolves via loadLocalSources() (it
  // is not a persisted local source), so checking sourceId first would
  // always miss and fall through to "unavailable" for these disks. See
  // HARD9-011/HARD10-002.
  if (disk.archiveRef) {
    return { kind: "archive-cache", archiveRef: disk.archiveRef };
  }
  if (disk.sourceId) {
    const source = loadLocalSources().find((entry) => entry.id === disk.sourceId);
    if (source?.android?.treeUri) {
      return { kind: "local-tree", treeUri: source.android.treeUri, path: normalizeSourcePath(disk.path) };
    }
    return { kind: "unavailable" };
  }
  return { kind: "unavailable" };
};

const persistDiskWriteBack = async (target: DiskWriteBackTarget, bytes: Uint8Array): Promise<void> => {
  if (target.kind === "local-tree") {
    await FolderPicker.writeFileToTree({
      treeUri: target.treeUri,
      path: target.path,
      data: uint8ToBase64(bytes),
      overwrite: true,
    });
    return;
  }
  if (target.kind === "archive-cache") {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    setCachedArchiveDiskBlob(target.archiveRef, new Blob([buffer]));
    return;
  }
  throw new Error("No write-back target is available for this disk.");
};

type MaterializedDiskMount = {
  disk: DiskEntry;
  workPath: string;
  writeBackTarget: DiskWriteBackTarget;
  // HARD19-005: the device this image was materialized to. The work file is a
  // deterministic per-drive name reused on every device, so without recording
  // the device, an eject after a saved-device switch would FTP-read a DIFFERENT
  // device's stale work file and overwrite the user's local source with it.
  deviceHost: string;
};

// HARD19-006: persist the map across process death so a post-restart eject can
// still finalize in-game saves instead of silently discarding them.
const MATERIALIZED_MOUNTS_STORAGE_KEY = "c64u.materializedDiskMounts.v1";

const persistMaterializedMounts = () => {
  if (typeof sessionStorage === "undefined") return;
  try {
    const serialized = Array.from(materializedMounts.entries()).map(([drive, entry]) => [drive, entry]);
    if (serialized.length === 0) {
      sessionStorage.removeItem(MATERIALIZED_MOUNTS_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(MATERIALIZED_MOUNTS_STORAGE_KEY, JSON.stringify(serialized));
  } catch (error) {
    addLog("warn", "Failed to persist materialized disk mounts", { error: (error as Error).message });
  }
};

const rehydrateMaterializedMounts = (): Map<"a" | "b", MaterializedDiskMount> => {
  const map = new Map<"a" | "b", MaterializedDiskMount>();
  if (typeof sessionStorage === "undefined") return map;
  try {
    const raw = sessionStorage.getItem(MATERIALIZED_MOUNTS_STORAGE_KEY);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as Array<[string, MaterializedDiskMount]>;
    for (const [drive, entry] of parsed) {
      if ((drive === "a" || drive === "b") && entry?.disk && entry.workPath && typeof entry.deviceHost === "string") {
        map.set(drive, entry);
      }
    }
  } catch (error) {
    addLog("warn", "Failed to rehydrate materialized disk mounts", { error: (error as Error).message });
  }
  return map;
};

// Module-singleton by design (mirrors machineExecutionStore/
// backgroundExecutionManager): drive occupancy is a device-level concept,
// not a per-component one, and must survive HomeDiskManager remounts. Rehydrated
// from sessionStorage on load so it also survives Android process death.
const materializedMounts = rehydrateMaterializedMounts();

const setMaterializedMount = (drive: "a" | "b", entry: MaterializedDiskMount) => {
  materializedMounts.set(drive, entry);
  persistMaterializedMounts();
};

const deleteMaterializedMount = (drive: "a" | "b") => {
  materializedMounts.delete(drive);
  persistMaterializedMounts();
};

// HARD19-007: the materialized work file is path-mounted, so the drives poll
// reports the internal work filename instead of the disk's name. Expose the
// per-drive work path so HomeDiskManager's override-keep / mounted-disk-id
// matching can treat "still the overridden disk" for the work file too.
export const getMaterializedWorkPath = (drive: "a" | "b"): string | null =>
  materializedMounts.get(drive)?.workPath ?? null;

// HARD19-007: map a drive's materialized work file back to the disk it holds, so
// rotation / delete-protection survive even after HomeDiskManager's optimistic
// override was lost (e.g. a component remount) — the drives poll only ever reports
// the internal work filename.
export const getMaterializedDiskId = (drive: "a" | "b"): string | null =>
  materializedMounts.get(drive)?.disk.id ?? null;

export const resetMaterializedMountsForTests = () => {
  materializedMounts.clear();
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(MATERIALIZED_MOUNTS_STORAGE_KEY);
};

const readBackAndPersist = async (entry: MaterializedDiskMount, ftp: DiskMountWriteBackDependencies): Promise<void> => {
  const bytes = await ftp.readRemoteFile(entry.workPath);
  await persistDiskWriteBack(entry.writeBackTarget, bytes);
};

// A drive can be remounted directly (Play, or a second Home mount) without
// an explicit eject in between. Finalizing (or at least discarding) any
// stale entry here stops a later eject from misattributing a DIFFERENT
// disk's device-side bytes back to this drive's previous occupant.
const dropOrFinalizeStaleMaterializedMount = async (
  drive: "a" | "b",
  nextDisk: DiskEntry,
  ftp: DiskMountWriteBackDependencies | undefined,
  currentDeviceHost?: string,
): Promise<void> => {
  const stale = materializedMounts.get(drive);
  if (!stale || stale.disk.id === nextDisk.id) return;
  deleteMaterializedMount(drive);
  // HARD19-005: never write the stale entry back to a different device than the
  // one it was materialized on (the deterministic work file would be a different
  // image). Drop without a write-back on a device mismatch.
  if (currentDeviceHost !== undefined && stale.deviceHost !== currentDeviceHost) {
    addLog("warn", "Dropped pending disk write-back: stale mount belongs to a different device", {
      drive,
      path: stale.disk.path,
      workPath: stale.workPath,
      materializedOn: stale.deviceHost,
      currentDeviceHost,
    });
    return;
  }
  if (!ftp) {
    addLog("warn", "Dropped pending disk write-back: drive remounted by a flow without write-back support", {
      drive,
      path: stale.disk.path,
      workPath: stale.workPath,
    });
    return;
  }
  try {
    await readBackAndPersist(stale, ftp);
  } catch (error) {
    addErrorLog("Disk write-back failed while remounting a different disk", {
      drive,
      path: stale.disk.path,
      workPath: stale.workPath,
      error: (error as Error).message,
    });
  }
};

export type DiskWriteBackResult =
  | { attempted: false; reason?: "no-entry" | "device-mismatch" }
  | { attempted: true; success: true }
  | { attempted: true; success: false; error: Error };

// Called on eject: FTP-downloads the materialized work-dir image back and
// re-persists it to the source. Never throws - a failed write-back must not
// block the eject the user already asked for; the result tells the caller
// whether to surface a "changes may be lost" warning.
//
// HARD19-005: `currentDeviceHost` is the device the eject's FTP deps target. If
// the mount was materialized on a DIFFERENT device (a saved-device switch
// happened between mount and eject), skip the write-back entirely: reading the
// deterministic work file from the current device would fetch a different (or
// stale) image and overwrite the user's local source with it. The entry is left
// in place so ejecting after switching BACK to the original device still saves.
export const finalizeDiskWriteBack = async (
  drive: "a" | "b",
  ftp: DiskMountWriteBackDependencies,
  currentDeviceHost?: string,
): Promise<DiskWriteBackResult> => {
  const entry = materializedMounts.get(drive);
  if (!entry) return { attempted: false, reason: "no-entry" };
  if (currentDeviceHost !== undefined && entry.deviceHost !== currentDeviceHost) {
    addLog("warn", "Skipped disk write-back: mount belongs to a different device than the current one", {
      drive,
      path: entry.disk.path,
      workPath: entry.workPath,
      materializedOn: entry.deviceHost,
      currentDeviceHost,
    });
    return { attempted: false, reason: "device-mismatch" };
  }
  deleteMaterializedMount(drive);
  try {
    await readBackAndPersist(entry, ftp);
    addLog("info", "Disk write-back persisted to source", { drive, path: entry.disk.path, workPath: entry.workPath });
    return { attempted: true, success: true };
  } catch (error) {
    addErrorLog("Disk write-back failed", {
      drive,
      path: entry.disk.path,
      workPath: entry.workPath,
      error: (error as Error).message,
    });
    return { attempted: true, success: false, error: error as Error };
  }
};

// Called when a mounted disk is being removed from the library outright
// (HARD18-017 delete flow) - there is no source left to write back to, so
// drop the pending entry without spending an FTP round trip on it.
export const discardDiskWriteBack = (drive: "a" | "b"): void => {
  deleteMaterializedMount(drive);
};

const DISK_WRITE_BACK_ADVISORY_STORAGE_KEY = "c64u_disk_writeback_advisory_shown_v1";

// A residual-case, one-time notice (not per-disk) that changes to THIS mount
// won't be saved back - shown only when materialization was unavailable or
// failed (DiskMountOutcome.persistence === "transient"). See HARD18-025.
export const hasShownDiskWriteBackAdvisory = (): boolean => {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(DISK_WRITE_BACK_ADVISORY_STORAGE_KEY) === "1";
};

export const markDiskWriteBackAdvisoryShown = (): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DISK_WRITE_BACK_ADVISORY_STORAGE_KEY, "1");
};

// HARD19-014 (decision D2): an archive/CommoServe disk "materializes" (so it does
// NOT hit the transient advisory above), but its write-back only lands in a
// 10-minute in-memory LRU (archiveDiskCache) — saves evaporate on TTL/eviction/
// restart. Classify it as session-transient and warn once with session-scoped
// wording. A separate one-time flag so it does not conflate with the "never saved"
// transient advisory.
const DISK_ARCHIVE_ADVISORY_STORAGE_KEY = "c64u_disk_archive_writeback_advisory_shown_v1";

export const hasShownArchiveDiskWriteBackAdvisory = (): boolean => {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(DISK_ARCHIVE_ADVISORY_STORAGE_KEY) === "1";
};

export const markArchiveDiskWriteBackAdvisoryShown = (): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DISK_ARCHIVE_ADVISORY_STORAGE_KEY, "1");
};

// Flat file directly under the persistent root - NOT a subdirectory. The
// native FTP plugin's writeFile only ever calls Commons Net's storeFile()
// (FtpClientPlugin.kt); it has no MKD/mkdir capability, so a work-dir path
// would silently never materialize on a device where that folder doesn't
// already exist (hardware-confirmed on c64u fw 1.1.0: STOR into a
// not-yet-created subfolder fails). Mirrors REU preload's existing flat
// naming convention (reuWorkflow.ts's `/${folderName}/${REU_PRELOAD_FILE_NAME}`).
const buildDiskWorkPath = (root: string, drive: "a" | "b", mountType: string) =>
  `/${root}/${DISK_WORK_DIR_NAME}-${drive}.${mountType}`;

// Deterministic, reused per-drive work filename (overwritten on every
// materialized mount) rather than one file per mount - the FTP plugin has no
// delete primitive, so "cleanup" means never accumulating new files, not
// removing old ones.
const tryMaterializeDiskMount = async (
  api: C64API,
  drive: "a" | "b",
  disk: DiskEntry,
  blob: Blob,
  mountType: string,
  mode: "readwrite" | "readonly" | "unlinked",
  writeBackTarget: DiskWriteBackTarget,
  ftp: DiskMountWriteBackDependencies,
): Promise<string | null> => {
  let root: string | null;
  try {
    root = resolvePersistentReuStorageRoot(await ftp.listRemoteStorageRoots());
  } catch (error) {
    addErrorLog("Disk work-dir storage root discovery failed; falling back to a transient mount", {
      drive,
      path: disk.path,
      error: (error as Error).message,
    });
    return null;
  }
  if (!root) {
    addLog("debug", "No persistent storage available for disk write-back materialization; buffer-mounting", {
      drive,
      path: disk.path,
    });
    return null;
  }
  const workPath = buildDiskWorkPath(root, drive, mountType);
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await ftp.writeRemoteFile(workPath, bytes);
    await api.mountDrive(drive, workPath, mountType, mode);
    setMaterializedMount(drive, { disk, workPath, writeBackTarget, deviceHost: api.getDeviceHost() });
    return workPath;
  } catch (error) {
    addErrorLog("Disk work-dir materialization failed; falling back to a transient mount", {
      drive,
      path: disk.path,
      workPath,
      error: (error as Error).message,
    });
    return null;
  }
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
  if (!loadDebugLoggingEnabled()) {
    // HARD12-013: skip the expensive full-image FNV-1a hash when debug
    // logging is off — the fingerprint is purely diagnostic and was the only
    // reason we walked the whole byte array.
    addLog("debug", "Local disk bytes resolved", {
      path: disk.path,
      location: disk.location,
      sourceId: disk.sourceId ?? null,
      localUri: disk.localUri ?? null,
      localTreeUri: disk.localTreeUri ?? null,
      resolutionSource: source,
    });
    return;
  }
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

// A CommoServe-imported disk keeps its bytes only in the in-memory runtimeFiles
// map, which is lost on device switch / app restart. When the runtime bytes are
// gone but the persisted entry carries an archiveRef, re-download the image on
// demand from the deterministic CommoServe REST URL - mirroring the tested
// playlist re-download path (resolveCommoServeRuntimeRequest) and sharing the
// same archive coordinates. A short-lived LRU cache absorbs repeated mounts.
// See HARD10-002.
const resolveArchiveDiskBlob = async (
  disk: DiskEntry,
  archiveRef: ArchivePlaylistReference,
  archiveConfigs: Record<string, ArchiveClientConfigInput> | undefined,
  signal: AbortSignal | undefined,
): Promise<Blob> => {
  const context = "Archive disk download";
  throwIfAborted(signal, context);

  const cachedBlob = getCachedArchiveDiskBlob(archiveRef);
  if (cachedBlob) {
    addLog("debug", "Local disk bytes resolved", {
      path: disk.path,
      location: disk.location,
      sourceId: disk.sourceId ?? null,
      resolutionSource: "archive-cache",
      sizeBytes: cachedBlob.size,
    });
    return cachedBlob;
  }

  const config = archiveConfigs?.[archiveRef.sourceId];
  if (!config) {
    throw new Error(`Archive source configuration unavailable for ${archiveRef.sourceId}.`);
  }

  const client = createArchiveClient(config);
  const binary = await client.downloadBinary(
    archiveRef.resultId,
    archiveRef.category,
    archiveRef.entryId,
    archiveRef.entryPath,
    { signal },
  );
  throwIfAborted(signal, context);

  if (binary.bytes.byteLength > MAX_LOCAL_DISK_IMAGE_BYTES) {
    throw new Error(`${context} is too large to mount (${binary.bytes.byteLength} bytes).`);
  }

  const buffer = new ArrayBuffer(binary.bytes.byteLength);
  new Uint8Array(buffer).set(binary.bytes);
  const blob = new Blob([buffer], {
    type: binary.contentType ?? "application/octet-stream",
  });
  setCachedArchiveDiskBlob(archiveRef, blob);
  logResolvedLocalDiskBytes(disk, "archive-download", binary.bytes);
  return blob;
};

export const resolveLocalDiskBlob = async (
  disk: DiskEntry,
  runtimeFile?: File,
  options: ResolveLocalDiskBlobOptions = {},
): Promise<Blob> => {
  const { signal, archiveConfigs } = options;
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
    // HARD12-013: the diagnostic log is the only consumer of the bytes; when
    // debug logging is disabled skip the extra arrayBuffer() read entirely.
    if (loadDebugLoggingEnabled()) {
      const bytes = new Uint8Array(await runtimeFile.arrayBuffer());
      throwIfAborted(signal, "Local disk runtime file read");
      logResolvedLocalDiskBytes(disk, "runtime-file", bytes);
    }
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
  // The runtime bytes are gone: a CommoServe disk with an archiveRef re-downloads
  // on demand instead of dead-ending at throwUnresolvedLocalDiskError. This runs
  // before the local-source scan/throw because a CommoServe disk carries a
  // sourceId that never resolves via loadLocalSources() and would otherwise hit
  // the HARD9-068 sourceId dead-end below. See HARD10-002.
  if (disk.archiveRef) {
    return resolveArchiveDiskBlob(disk, disk.archiveRef, archiveConfigs, signal);
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

  const throwUnresolvedLocalDiskError = (): never => {
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

  if (disk.sourceId) {
    const source = sources.find((entry) => entry.id === disk.sourceId);
    if (source) {
      const blob = await resolveFromSource(source);
      if (blob) return blob;
    }
    // A disk with a sourceId must resolve through that specific source or
    // not at all - falling back to scanning every other local source by path
    // risks silently mounting a different folder's same-named file (e.g. two
    // libraries both containing /side-a.d64). See HARD9-068.
    return throwUnresolvedLocalDiskError();
  }

  for (const source of sources) {
    const blob = await resolveFromSource(source);
    if (blob) return blob;
  }

  return throwUnresolvedLocalDiskError();
};

export const mountDiskToDrive = async (
  api: C64API,
  drive: "a" | "b",
  disk: DiskEntry,
  runtimeFile?: File,
  options: MountDiskToDriveOptions = {},
): Promise<DiskMountOutcome> => {
  const mode = options.mode ?? "readwrite";
  await dropOrFinalizeStaleMaterializedMount(drive, disk, options.writeBack, api.getDeviceHost());
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
        return { persistence: "device-native" };
      } else if (disk.origin) {
        const blob = await fetchUltimateOriginBlob(disk.origin);
        await api.mountDriveUpload(drive, blob, mountType, mode, { filename: disk.origin.originPath });
        return { persistence: "transient", writeBackTarget: { kind: "unavailable" } };
      } else {
        await api.mountDrive(drive, disk.path, mountType, mode);
        return { persistence: "device-native" };
      }
    }

    const blob = await resolveLocalDiskBlob(disk, runtimeFile, {
      archiveConfigs: options.archiveConfigs,
    });
    addLog("debug", "Local disk blob prepared for mount", {
      drive,
      path: disk.path,
      location: disk.location,
      sourceId: disk.sourceId ?? null,
      sizeBytes: blob.size,
    });

    const writeBackTarget = resolveDiskWriteBackTarget(disk);
    if (options.writeBack && mode === "readwrite" && writeBackTarget.kind !== "unavailable") {
      const workPath = await tryMaterializeDiskMount(
        api,
        drive,
        disk,
        blob,
        mountType,
        mode,
        writeBackTarget,
        options.writeBack,
      );
      if (workPath) {
        return { persistence: "materialized", writeBackTarget, workPath };
      }
    }

    await api.mountDriveUpload(drive, blob, mountType, mode, { filename: disk.path });
    return { persistence: "transient", writeBackTarget };
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
