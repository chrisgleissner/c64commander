/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { ArchivePlaylistReference } from "@/lib/archive/types";
import {
  areKnownDifferentDiskDevices,
  isSameDiskDevice,
  resolveDiskDeviceIdentity,
  type DiskDeviceIdentity,
} from "./diskDeviceIdentity";
import type { DiskEntry } from "./diskTypes";

export type DiskWriteBackTarget =
  | { kind: "local-tree"; treeUri: string; path: string }
  | { kind: "archive-cache"; archiveRef: ArchivePlaylistReference }
  | { kind: "unavailable" };

type DriveKey = "a" | "b";

export type MaterializedDiskMount = {
  disk: DiskEntry;
  workPath: string;
  writeBackTarget: DiskWriteBackTarget;
  // HARD19-005: the work file name is reused on every device, so an entry must know which device holds its bytes.
  deviceHost: string;
  deviceUniqueId?: string | null;
  // Order of work-file writes, so a read-back can tell whether a later mount replaced this entry's bytes.
  generation?: number;
};

type WorkFileWrite = { workPath: string; deviceHost: string; deviceUniqueId: string | null; generation: number };

export const materializedMountDevice = (entry: MaterializedDiskMount): DiskDeviceIdentity => ({
  host: entry.deviceHost,
  uniqueId: entry.deviceUniqueId ?? null,
});

// HARD19-006: persisted across process death so a post-restart eject can still finalize in-game saves.
const MATERIALIZED_MOUNTS_STORAGE_KEY = "c64u.materializedDiskMounts.v1";
// HARD21-002: an entry displaced from its drive slot by a mount on another device waits here for that device.
const ORPHANED_MOUNTS_STORAGE_KEY = "c64u.materializedDiskMounts.orphaned.v1";
const WORK_FILE_WRITES_STORAGE_KEY = "c64u.diskWorkFileWrites.v1";
const MAX_WORK_FILE_WRITES = 64;

const isValidEntry = (entry: MaterializedDiskMount | undefined): entry is MaterializedDiskMount =>
  Boolean(entry?.disk && entry.workPath && typeof entry.deviceHost === "string");

const readStored = <T>(key: string, label: string): T | null => {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    addLog("warn", `Failed to rehydrate ${label}`, { error: (error as Error).message });
    return null;
  }
};

const writeStored = (key: string, label: string, value: unknown[]) => {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (value.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    addLog("warn", `Failed to persist ${label}`, { error: (error as Error).message });
  }
};

// Module singletons by design: drive occupancy is device-level and must survive HomeDiskManager remounts.
const materializedMounts = new Map<DriveKey, MaterializedDiskMount>(
  (
    readStored<Array<[string, MaterializedDiskMount]>>(MATERIALIZED_MOUNTS_STORAGE_KEY, "materialized disk mounts") ??
    []
  ).filter(
    (pair): pair is [DriveKey, MaterializedDiskMount] => (pair[0] === "a" || pair[0] === "b") && isValidEntry(pair[1]),
  ),
);
// Keyed by JSON [deviceHost, drive], which also keeps an IPv6 host's colons unambiguous.
const orphanKey = (deviceHost: string, drive: DriveKey) => JSON.stringify([deviceHost, drive]);
const orphanDrive = (key: string): DriveKey | null =>
  key.endsWith(',"a"]') ? "a" : key.endsWith(',"b"]') ? "b" : null;
const orphanedMounts = new Map<string, MaterializedDiskMount>(
  (
    readStored<Array<[string, MaterializedDiskMount]>>(ORPHANED_MOUNTS_STORAGE_KEY, "orphaned disk mounts") ?? []
  ).filter(([key, entry]) => typeof key === "string" && orphanDrive(key) !== null && isValidEntry(entry)),
);
let workFileWrites: WorkFileWrite[] =
  readStored<WorkFileWrite[]>(WORK_FILE_WRITES_STORAGE_KEY, "disk work-file writes")?.filter(
    (write) => typeof write?.workPath === "string" && typeof write.generation === "number",
  ) ?? [];
let lastGeneration = Math.max(
  0,
  ...workFileWrites.map((write) => write.generation),
  ...[...materializedMounts.values(), ...orphanedMounts.values()].map((entry) => entry.generation ?? 0),
);

const persistMaterializedMounts = () =>
  writeStored(MATERIALIZED_MOUNTS_STORAGE_KEY, "materialized disk mounts", Array.from(materializedMounts.entries()));
const persistOrphanedMounts = () =>
  writeStored(ORPHANED_MOUNTS_STORAGE_KEY, "orphaned disk mounts", Array.from(orphanedMounts.entries()));

/** Call before writing a work file, so even a write that fails halfway marks older entries' bytes as replaced. */
export const recordWorkFileWrite = (workPath: string, device: DiskDeviceIdentity): number => {
  lastGeneration += 1;
  const generation = lastGeneration;
  const writeDevice = (write: WorkFileWrite) => ({ host: write.deviceHost, uniqueId: write.deviceUniqueId });
  workFileWrites = [
    ...workFileWrites.filter((write) => write.workPath !== workPath || !isSameDiskDevice(writeDevice(write), device)),
    { workPath, deviceHost: device.host, deviceUniqueId: device.uniqueId, generation },
  ].slice(-MAX_WORK_FILE_WRITES);
  writeStored(WORK_FILE_WRITES_STORAGE_KEY, "disk work-file writes", workFileWrites);
  return generation;
};

export const getPrimaryMaterializedMount = (drive: DriveKey) => materializedMounts.get(drive);

export const recordMaterializedMount = (
  drive: DriveKey,
  mount: Omit<MaterializedDiskMount, "deviceHost" | "deviceUniqueId">,
  device: DiskDeviceIdentity,
) => {
  const entry: MaterializedDiskMount = { ...mount, deviceHost: device.host, deviceUniqueId: device.uniqueId };
  const existing = materializedMounts.get(drive);
  if (existing && !isSameDiskDevice(materializedMountDevice(existing), device)) {
    orphanedMounts.set(orphanKey(existing.deviceHost, drive), existing);
    persistOrphanedMounts();
    addLog("warn", "Parked a different device's pending disk write-back before a cross-device remount", {
      drive,
      parkedDeviceHost: existing.deviceHost,
      currentDeviceHost: device.host,
      path: existing.disk.path,
    });
  }
  materializedMounts.set(drive, entry);
  persistMaterializedMounts();
};

export const deleteMaterializedMount = (drive: DriveKey) => {
  materializedMounts.delete(drive);
  persistMaterializedMounts();
};

export type PendingMaterializedMount = { entry: MaterializedDiskMount; release: () => void };

/** The pending write-back whose bytes sit in this drive's work file on `device`: its slot entry, else a parked one. */
export const findPendingMaterializedMount = (
  drive: DriveKey,
  device: DiskDeviceIdentity,
): PendingMaterializedMount | null => {
  const primary = materializedMounts.get(drive);
  if (primary && isSameDiskDevice(materializedMountDevice(primary), device)) {
    return { entry: primary, release: () => deleteMaterializedMount(drive) };
  }
  const [parkedKey, parked] =
    Array.from(orphanedMounts.entries())
      .filter(([key, entry]) => orphanDrive(key) === drive && isSameDiskDevice(materializedMountDevice(entry), device))
      .sort(([, a], [, b]) => (b.generation ?? 0) - (a.generation ?? 0))[0] ?? [];
  if (!parkedKey || !parked) return null;
  return {
    entry: parked,
    release: () => {
      orphanedMounts.delete(parkedKey);
      persistOrphanedMounts();
    },
  };
};

export const findPendingMaterializedMountForHost = (drive: DriveKey, deviceHost?: string) => {
  if (deviceHost === undefined) {
    const primary = materializedMounts.get(drive);
    return primary ? { entry: primary, release: () => deleteMaterializedMount(drive) } : null;
  }
  return findPendingMaterializedMount(drive, resolveDiskDeviceIdentity(deviceHost));
};

/**
 * The later work-file write that replaced this entry's bytes, if any. A write on a device that is not known to be a
 * different machine counts: two saved addresses without a known unique id may be the same Ultimate.
 */
export const findLaterWorkFileWrite = (entry: MaterializedDiskMount) =>
  workFileWrites.find(
    (write) =>
      write.workPath === entry.workPath &&
      write.generation > (entry.generation ?? 0) &&
      !areKnownDifferentDiskDevices(
        { host: write.deviceHost, uniqueId: write.deviceUniqueId },
        materializedMountDevice(entry),
      ),
  ) ?? null;

// HARD19-007: the drives poll reports a materialized mount's internal work file, never the disk's own name.
export const getMaterializedWorkPath = (drive: DriveKey, deviceHost?: string): string | null =>
  findPendingMaterializedMountForHost(drive, deviceHost)?.entry.workPath ?? null;

export const getMaterializedDiskId = (drive: DriveKey, deviceHost?: string): string | null =>
  findPendingMaterializedMountForHost(drive, deviceHost)?.entry.disk.id ?? null;

/** Drops the pending write-back for this drive on `deviceHost` (the slot entry when no host is given). */
export const discardDiskWriteBack = (drive: DriveKey, deviceHost?: string): void => {
  findPendingMaterializedMountForHost(drive, deviceHost)?.release();
};

export const resetMaterializedMountsForTests = () => {
  materializedMounts.clear();
  orphanedMounts.clear();
  workFileWrites = [];
  lastGeneration = 0;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(MATERIALIZED_MOUNTS_STORAGE_KEY);
    sessionStorage.removeItem(ORPHANED_MOUNTS_STORAGE_KEY);
    sessionStorage.removeItem(WORK_FILE_WRITES_STORAGE_KEY);
  }
};
