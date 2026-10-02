/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API, DriveInfo } from "@/lib/c64api";
import { onDriveWritten } from "@/lib/c64api/driveWriteSignal";
import { diskDeviceKey } from "@/lib/disks/diskDeviceIdentity";
import { normalizeDiskPath } from "@/lib/disks/diskPath";
import { addErrorLog, addLog } from "@/lib/logging";
import { getRegisteredQueryClient } from "@/lib/query/queryClientRegistry";
import { waitForMachineTransitionsToSettle } from "@/lib/deviceInteraction/deviceActivityGate";

export type LaunchDrive = "a" | "b";

/** A disk image Play mounted to launch an item, and what the drive held before Play first took it. */
export type PlayLaunchMount = {
  drive: LaunchDrive;
  launchPath: string;
  priorImagePath: string | null;
};

type PlayLaunchMountStore = Record<string, Partial<Record<LaunchDrive, PlayLaunchMount>>>;

// Persisted so a Stop after the app was closed mid-play still knows which image Play put in the drive.
const STORAGE_KEY = "c64u_play_launch_mounts";

const isDrive = (value: string): value is LaunchDrive => value === "a" || value === "b";

const readStore = (): PlayLaunchMountStore => {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PlayLaunchMountStore) : {};
  } catch (error) {
    addLog("warn", "Could not read the record of disks Play mounted", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return {};
  }
};

const writeStore = (store: PlayLaunchMountStore) => {
  try {
    if (typeof localStorage === "undefined") return;
    if (Object.keys(store).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    addLog("warn", "Could not save the record of disks Play mounted", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

const withoutDrive = (store: PlayLaunchMountStore, deviceKey: string, drive: LaunchDrive): PlayLaunchMountStore => {
  const forDevice = store[deviceKey];
  if (!forDevice?.[drive]) return store;
  const { [drive]: _removed, ...rest } = forDevice;
  const next = { ...store };
  if (Object.keys(rest).length === 0) delete next[deviceKey];
  else next[deviceKey] = rest;
  return next;
};

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

export const peekPlayLaunchMount = (deviceHost: string, drive: LaunchDrive): PlayLaunchMount | null =>
  readStore()[diskDeviceKey(deviceHost)]?.[drive] ?? null;

export const recordPlayLaunchMount = (deviceHost: string, mount: PlayLaunchMount) => {
  const store = readStore();
  const deviceKey = diskDeviceKey(deviceHost);
  writeStore({ ...store, [deviceKey]: { ...store[deviceKey], [mount.drive]: mount } });
};

/**
 * Any other mount or eject on the drive: the drive no longer holds what Play put there, so Stop must leave it.
 * Every drive mount and eject in the app goes through the REST client, which calls this.
 */
export const forgetPlayLaunchMount = (deviceHost: string, drive: string) => {
  if (!isDrive(drive)) return;
  const store = readStore();
  const next = withoutDrive(store, diskDeviceKey(deviceHost), drive);
  if (next !== store) writeStore(next);
};

onDriveWritten(forgetPlayLaunchMount);

const playLaunchMountsFor = (deviceHost: string): PlayLaunchMount[] =>
  Object.values(readStore()[diskDeviceKey(deviceHost)] ?? {}).filter((mount): mount is PlayLaunchMount =>
    Boolean(mount),
  );

const mountTypeOf = (path: string) => {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
};

/**
 * Stop ends what Play started: eject each image Play mounted on this device and put back the image the user
 * had in that drive before. One request per drive operation; a failure is logged and the next drive is tried.
 * A drive leaves the record only once its eject succeeded, so a later Stop retries a failed one.
 */
export const endPlayLaunchMounts = async (api: Pick<C64API, "getDeviceHost" | "unmountDrive" | "mountDrive">) => {
  if (Object.keys(readStore()).length === 0) return;
  const deviceHost = api.getDeviceHost();
  const mounts = playLaunchMountsFor(deviceHost);
  if (mounts.length > 0) await waitForMachineTransitionsToSettle();
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
  if (mounts.length > 0) void getRegisteredQueryClient()?.invalidateQueries({ queryKey: ["c64-drives"] });
};
