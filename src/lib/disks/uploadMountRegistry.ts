/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DiskMountPersistence } from "./diskMount";
import { diskDeviceKey } from "./diskDeviceIdentity";

// An uploaded image is mounted from a device-side temporary file, and /v1/drives reports that
// file (e.g. "/Temp/cache/upload/temp0082") instead of the library disk's path. This registry
// remembers which library disk an upload mount holds, learns the reported path from the first
// poll after the mount, and forgets it once the drive reports a different image or none.

type UploadDriveKey = "a" | "b";

export type UploadMountRecord = {
  diskId: string;
  diskName?: string;
  startedAt?: number;
  imagePath: string | null;
  recordedAt: number;
};

export type UploadMountState = Readonly<Record<string, UploadMountRecord>>;

// By device identity, so the same Ultimate reached through its other saved address still names its disk.
const recordKey = (deviceHost: string, drive: UploadDriveKey) => JSON.stringify([diskDeviceKey(deviceHost), drive]);

const withoutRecord = (state: UploadMountState, key: string): UploadMountState => {
  if (!(key in state)) return state;
  const next = { ...state };
  delete next[key];
  return next;
};

// A drive that still reports another image this long after the mount holds something else.
const UPLOAD_PATH_LEARN_WINDOW_MS = 15_000;

const looksLikeUploadOf = (imagePath: string, diskName: string | undefined) =>
  /\/cache\/upload\//i.test(imagePath) ||
  (diskName !== undefined && imagePath.split("/").pop()?.toLowerCase() === diskName.toLowerCase());

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
  if (record.imagePath === null) {
    if (looksLikeUploadOf(polledImagePath, record.diskName)) {
      return { ...state, [key]: { ...record, imagePath: polledImagePath } };
    }
    return polledAt - record.recordedAt > UPLOAD_PATH_LEARN_WINDOW_MS ? withoutRecord(state, key) : state;
  }
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

// Kept in memory only: it survives page changes, but not a reload. A temporary upload path is reused by the
// device after a reboot or by another client, so after a reload only a new mount by this app can vouch for one.
let uploadMounts: UploadMountState = {};

const replaceUploadMounts = (next: UploadMountState) => {
  uploadMounts = next;
};

export const noteDiskMountOutcome = (
  deviceHost: string,
  drive: UploadDriveKey,
  diskId: string,
  persistence: DiskMountPersistence | undefined,
  diskName?: string,
  mountStartedAt = Date.now(),
) => {
  const key = recordKey(deviceHost, drive);
  const existing = uploadMounts[key];
  if ((existing?.startedAt ?? existing?.recordedAt ?? -Infinity) > mountStartedAt) return;
  if (persistence !== "transient") {
    replaceUploadMounts(withoutRecord(uploadMounts, key));
    return;
  }
  replaceUploadMounts({
    ...uploadMounts,
    [key]: { diskId, diskName, imagePath: null, startedAt: mountStartedAt, recordedAt: Date.now() },
  });
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

/** The library name of the disk an upload mount holds, when the polled image is that mount's upload. */
export const getUploadMountedDiskName = (
  deviceHost: string,
  drive: UploadDriveKey,
  polledImagePath: string | null,
  polledAt: number,
) => {
  if (!polledImagePath) return null;
  const record = reconcileUploadMount(uploadMounts, deviceHost, drive, polledImagePath, polledAt)[
    recordKey(deviceHost, drive)
  ];
  return record?.imagePath === polledImagePath ? (record.diskName ?? null) : null;
};

export const resetUploadMountsForTests = () => replaceUploadMounts({});
