/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { DiskMountPersistence } from "./diskMount";

// An uploaded image is mounted from a device-side temporary file, and /v1/drives reports that
// file (e.g. "/Temp/cache/upload/temp0082") instead of the library disk's path. This registry
// remembers which library disk an upload mount holds, learns the reported path from the first
// poll after the mount, and forgets it once the drive reports a different image or none.

type UploadDriveKey = "a" | "b";

export type UploadMountRecord = {
  diskId: string;
  imagePath: string | null;
  recordedAt: number;
};

export type UploadMountState = Readonly<Record<string, UploadMountRecord>>;

const recordKey = (deviceHost: string, drive: UploadDriveKey) => JSON.stringify([deviceHost, drive]);

const withoutRecord = (state: UploadMountState, key: string): UploadMountState => {
  if (!(key in state)) return state;
  const next = { ...state };
  delete next[key];
  return next;
};

export const reconcileUploadMount = (
  state: UploadMountState,
  deviceHost: string,
  drive: UploadDriveKey,
  polledImagePath: string | null,
  polledAt: number,
): UploadMountState => {
  const key = recordKey(deviceHost, drive);
  const record = state[key];
  if (!record || polledAt < record.recordedAt) return state;
  if (!polledImagePath) return withoutRecord(state, key);
  if (record.imagePath === null) return { ...state, [key]: { ...record, imagePath: polledImagePath } };
  return record.imagePath === polledImagePath ? state : withoutRecord(state, key);
};

export const resolveUploadMountedDiskId = (
  state: UploadMountState,
  deviceHost: string,
  drive: UploadDriveKey,
  polledImagePath: string | null,
  polledAt: number,
): string | null => {
  if (!polledImagePath) return null;
  const record = reconcileUploadMount(state, deviceHost, drive, polledImagePath, polledAt)[
    recordKey(deviceHost, drive)
  ];
  return record?.imagePath === polledImagePath ? record.diskId : null;
};

const UPLOAD_MOUNTS_STORAGE_KEY = "c64u.uploadDiskMounts.v1";

const isUploadMountRecord = (value: unknown): value is UploadMountRecord => {
  const record = value as UploadMountRecord | null;
  return (
    typeof record?.diskId === "string" &&
    typeof record.recordedAt === "number" &&
    (record.imagePath === null || typeof record.imagePath === "string")
  );
};

const rehydrateUploadMounts = (): UploadMountState => {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(UPLOAD_MOUNTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, record]) => isUploadMountRecord(record))) as Record<
      string,
      UploadMountRecord
    >;
  } catch (error) {
    addLog("warn", "Failed to rehydrate upload disk mounts", { error: (error as Error).message });
    return {};
  }
};

let uploadMounts: UploadMountState = rehydrateUploadMounts();

const replaceUploadMounts = (next: UploadMountState) => {
  if (next === uploadMounts) return;
  uploadMounts = next;
  if (typeof sessionStorage === "undefined") return;
  try {
    if (Object.keys(next).length === 0) sessionStorage.removeItem(UPLOAD_MOUNTS_STORAGE_KEY);
    else sessionStorage.setItem(UPLOAD_MOUNTS_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    addLog("warn", "Failed to persist upload disk mounts", { error: (error as Error).message });
  }
};

export const noteDiskMountOutcome = (
  deviceHost: string,
  drive: UploadDriveKey,
  diskId: string,
  persistence: DiskMountPersistence | undefined,
  mountedAt = Date.now(),
) => {
  const key = recordKey(deviceHost, drive);
  if (persistence !== "transient") {
    replaceUploadMounts(withoutRecord(uploadMounts, key));
    return;
  }
  replaceUploadMounts({ ...uploadMounts, [key]: { diskId, imagePath: null, recordedAt: mountedAt } });
};

export const forgetUploadMount = (deviceHost: string, drive: UploadDriveKey) =>
  replaceUploadMounts(withoutRecord(uploadMounts, recordKey(deviceHost, drive)));

export const learnUploadMountFromPoll = (
  deviceHost: string,
  drive: UploadDriveKey,
  polledImagePath: string | null,
  polledAt: number,
) => replaceUploadMounts(reconcileUploadMount(uploadMounts, deviceHost, drive, polledImagePath, polledAt));

export const getUploadMountedDiskId = (
  deviceHost: string,
  drive: UploadDriveKey,
  polledImagePath: string | null,
  polledAt: number,
) => resolveUploadMountedDiskId(uploadMounts, deviceHost, drive, polledImagePath, polledAt);

export const resetUploadMountsForTests = () => replaceUploadMounts({});
