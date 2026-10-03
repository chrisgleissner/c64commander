/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { diskDeviceKey } from "@/lib/disks/diskDeviceIdentity";
import { addLog } from "@/lib/logging";

export type LaunchDrive = "a" | "b";

/** A disk image Play mounted to launch an item, and what the drive held before Play first took it. */
export type PlayLaunchMount = {
  drive: LaunchDrive;
  launchPath: string;
  priorImagePath: string | null;
  /** Mounted from uploaded bytes, so the drive reports a device-side upload file, not launchPath. */
  mountedByUpload?: boolean;
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

export const peekPlayLaunchMount = (deviceHost: string, drive: LaunchDrive): PlayLaunchMount | null =>
  readStore()[diskDeviceKey(deviceHost)]?.[drive] ?? null;

export const recordPlayLaunchMount = (deviceHost: string, mount: PlayLaunchMount) => {
  const store = readStore();
  const deviceKey = diskDeviceKey(deviceHost);
  writeStore({ ...store, [deviceKey]: { ...store[deviceKey], [mount.drive]: mount } });
};

/**
 * Any other mount or eject on the drive: the drive no longer holds what Play put there, so Stop must leave it.
 * Every drive mount and eject in the app goes through the REST client, which calls this. Kept apart from the
 * Stop logic so the startup bundle can carry it.
 */
export const forgetPlayLaunchMount = (deviceHost: string, drive: string) => {
  if (!isDrive(drive)) return;
  const store = readStore();
  const next = withoutDrive(store, diskDeviceKey(deviceHost), drive);
  if (next !== store) writeStore(next);
};

export const hasAnyPlayLaunchMount = () => Object.keys(readStore()).length > 0;

export const playLaunchMountsFor = (deviceHost: string): PlayLaunchMount[] =>
  Object.values(readStore()[diskDeviceKey(deviceHost)] ?? {}).filter((mount): mount is PlayLaunchMount =>
    Boolean(mount),
  );
