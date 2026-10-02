/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API, DriveInfo, DrivesResponse } from "@/lib/c64api";
import { normalizeDiskPath } from "@/lib/disks/diskPath";
import { addErrorLog, addLog } from "@/lib/logging";
import { getRegisteredQueryClient } from "@/lib/query/queryClientRegistry";
import { waitForMachineTransitionsToSettle } from "@/lib/deviceInteraction/deviceActivityGate";
import {
  forgetPlayLaunchMount,
  hasAnyPlayLaunchMount,
  playLaunchMountsFor,
  type PlayLaunchMount,
} from "./playLaunchMountStore";

export {
  forgetPlayLaunchMount,
  peekPlayLaunchMount,
  recordPlayLaunchMount,
  type LaunchDrive,
  type PlayLaunchMount,
} from "./playLaunchMountStore";

/** The image a drive reports, as one normalized device path, or null for an empty drive. */
export const describeDriveImage = (info: DriveInfo | null | undefined): string | null => {
  const file = info?.image_file?.trim();
  if (!file) return null;
  const base = info?.image_path?.trim() || "/";
  return normalizeDiskPath(base.endsWith("/") ? `${base}${file}` : `${base}/${file}`);
};

/**
 * What a new launch mount should restore on Stop. A drive Play already holds keeps the image the user had
 * before Play's first mount; otherwise it is whatever the drive held just before this mount.
 */
export const resolvePriorImageForLaunch = (
  existing: PlayLaunchMount | null,
  driveBeforeMount: DriveInfo | null,
): string | null => (existing ? existing.priorImagePath : describeDriveImage(driveBeforeMount));

const mountTypeOf = (path: string) => {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
};

const imageName = (path: string) => path.split("/").pop() ?? "";

// An upload mount reports the uploaded file under a device directory, not the library path, so the name decides.
const driveStillHoldsLaunchImage = (drives: DrivesResponse, mount: PlayLaunchMount) => {
  const held = describeDriveImage(drives.drives?.find((entry) => entry[mount.drive])?.[mount.drive]);
  return held !== null && imageName(held) === imageName(normalizeDiskPath(mount.launchPath));
};

/**
 * Stop ends what Play started: eject each image Play mounted on this device and put back the image the user
 * had in that drive before. One request per drive operation; a failure is logged and the next drive is tried.
 * A drive leaves the record only once its eject succeeded, so a later Stop retries a failed one. A drive that
 * no longer holds Play's image (changed from the device's own menu, or in a session that never told this
 * record) is left alone.
 */
export const endPlayLaunchMounts = async (
  api: Pick<C64API, "getDeviceHost" | "getDrives" | "unmountDrive" | "mountDrive">,
) => {
  if (!hasAnyPlayLaunchMount()) return;
  const deviceHost = api.getDeviceHost();
  const recorded = playLaunchMountsFor(deviceHost);
  if (recorded.length === 0) return;
  await waitForMachineTransitionsToSettle();
  let drives: DrivesResponse;
  try {
    drives = await api.getDrives();
  } catch (error) {
    addLog("warn", "Stop left the drives alone: could not read what they hold", {
      drives: recorded.map((mount) => mount.drive),
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return;
  }
  const mounts = recorded.filter((mount) => {
    if (driveStillHoldsLaunchImage(drives, mount)) return true;
    forgetPlayLaunchMount(deviceHost, mount.drive);
    addLog("info", "Stop left a drive alone: it no longer holds the disk Play mounted", {
      drive: mount.drive,
      launchPath: mount.launchPath,
    });
    return false;
  });
  for (const mount of mounts) {
    try {
      await api.unmountDrive(mount.drive);
      forgetPlayLaunchMount(deviceHost, mount.drive);
      addLog("info", "Stop ejected the disk Play mounted", { drive: mount.drive, path: mount.launchPath });
      if (mount.priorImagePath) {
        await api.mountDrive(mount.drive, mount.priorImagePath, mountTypeOf(mount.priorImagePath));
        addLog("info", "Stop put back the disk the drive held before Play", {
          drive: mount.drive,
          path: mount.priorImagePath,
        });
      }
    } catch (error) {
      addErrorLog("Stop could not return the drive to how Play found it", {
        drive: mount.drive,
        launchPath: mount.launchPath,
        priorImagePath: mount.priorImagePath,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  }
  void getRegisteredQueryClient()?.invalidateQueries({ queryKey: ["c64-drives"] });
};
