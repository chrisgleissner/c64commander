/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API, DriveInfo, DrivesResponse } from "@/lib/c64api";
import { getDiskName, type DiskEntry } from "@/lib/disks/diskTypes";
import { addLog } from "@/lib/logging";
import { getUploadMountedDiskId, learnUploadMountFromPoll } from "@/lib/disks/uploadMountRegistry";
import { buildDriveLabel, buildDrivePath, DRIVE_KEYS, type DriveKey } from "./HomeDiskManagerSupport";

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

export const buildMountTargetLabel = ({
  key,
  busId,
  driveType,
  mounted,
  powerEnabled,
}: {
  key: DriveKey;
  busId: number;
  driveType: string;
  mounted: boolean;
  powerEnabled: boolean | undefined;
}) => {
  const state = [mounted ? "mounted" : null, powerEnabled === false ? "off" : null].filter(Boolean).join(", ");
  return `${buildDriveLabel(key)} (#${busId}, ${driveType})${state ? ` • ${state}` : ""}`;
};

/** Turns an off drive on before mounting, so the mounted disk is reachable on the bus. */
export const mountOntoPoweredDrive = async <T>(
  api: Pick<C64API, "driveOn">,
  drive: DriveKey,
  powerEnabled: boolean | undefined,
  mount: () => Promise<T>,
): Promise<{ outcome: T; poweredOn: boolean }> => {
  const poweredOn = powerEnabled === false;
  if (poweredOn) {
    addLog("info", "Turning drive on before mounting a disk", { drive });
    try {
      await api.driveOn(drive);
    } catch (error) {
      throw new Error(`Could not turn ${buildDriveLabel(drive)} on to mount the disk: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  return { outcome: await mount(), poweredOn };
};

export const describeDiskMounted = (diskName: string, drive: DriveKey, poweredOn: boolean) =>
  `${diskName} mounted in ${buildDriveLabel(drive)}${poweredOn ? ", which was off and is now on" : ""}`;
