/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DriveInfo, DrivesResponse } from "@/lib/c64api";
import { getDiskName, type DiskEntry } from "@/lib/disks/diskTypes";
import { getUploadMountedDiskId, learnUploadMountFromPoll } from "@/lib/disks/uploadMountRegistry";
import { buildDrivePath, DRIVE_KEYS, type DriveKey } from "./HomeDiskManagerSupport";

export const findPolledDrive = (
  drivesData: DrivesResponse | null | undefined,
  drive: DriveKey,
): DriveInfo | undefined => drivesData?.drives?.find((entry) => entry[drive])?.[drive];

export const learnUploadMountsFromPoll = (
  deviceHost: string,
  drivesData: DrivesResponse | null | undefined,
  polledAt: number,
) =>
  DRIVE_KEYS.forEach((drive) => {
    const info = findPolledDrive(drivesData, drive);
    if (info) learnUploadMountFromPoll(deviceHost, drive, buildDrivePath(info.image_path, info.image_file), polledAt);
  });

/** The library disk an upload mount put in this drive, resolved through the image path the device reports. */
export const resolveUploadMountedDiskId = (
  deviceHost: string,
  drive: DriveKey,
  info: DriveInfo | undefined,
  polledAt: number,
) => getUploadMountedDiskId(deviceHost, drive, buildDrivePath(info?.image_path, info?.image_file), polledAt);

// A local disk is mounted by upload, so no poll reports its library path. Its optimistic override stands while
// the drive still reports the uploaded file name or, for a materialized mount, the drive's work file (HARD9-038,
// HARD19-007).
export const keepsLocalMountOverride = (
  disk: DiskEntry | undefined,
  polledImageFile: string | undefined,
  workPath: string | null,
) => {
  if (disk?.location !== "local" || !polledImageFile) return false;
  const polledName = getDiskName(polledImageFile);
  return polledName === getDiskName(disk.path) || (workPath !== null && polledName === getDiskName(workPath));
};
