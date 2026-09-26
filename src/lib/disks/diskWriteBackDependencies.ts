/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { listFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { resolveFtpConnectionOptions } from "@/lib/ftp/ftpConfig";
import { listPopulatedStorageRoots } from "@/lib/ftp/storageRoots";
import { base64ToUint8, uint8ToBase64 } from "@/lib/sid/sidUtils";
import type { DiskMountWriteBackDependencies } from "@/lib/disks/diskMount";
import { getC64APIConfigSnapshot } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";

/**
 * FTP-backed disk write-back dependencies (list roots / read / write remote
 * files). Extracted from HomeDiskManager so the Play page's `executePlayPlan`
 * disk case can pass the SAME dependencies (HARD19-008): without them, mounting a
 * disk from Play dropped a Home-mounted disk's pending write-back (silently losing
 * in-game saves) instead of finalizing it.
 *
 * The FTP host is the device the dependencies were built for (by default the selected device at that
 * moment), so a device switch during a write-back cannot move a work-file read or write to the other device.
 */
export const buildDiskWriteBackDependencies = (
  deviceHost: string = getC64APIConfigSnapshot().deviceHost,
): DiskMountWriteBackDependencies => {
  const ftpOptionsForDevice = async () => ({
    ...(await resolveFtpConnectionOptions()),
    host: stripPortFromDeviceHost(deviceHost),
  });
  return {
    listRemoteStorageRoots: async () => {
      const ftpOptions = await ftpOptionsForDevice();
      return listPopulatedStorageRoots((path) => listFtpDirectory({ ...ftpOptions, path }));
    },
    readRemoteFile: async (path) => {
      const result = await readFtpFile({ ...(await ftpOptionsForDevice()), path });
      return base64ToUint8(result.data);
    },
    writeRemoteFile: async (path, bytes) => {
      await writeFtpFile({ ...(await ftpOptionsForDevice()), path, data: uint8ToBase64(bytes) });
    },
  };
};
