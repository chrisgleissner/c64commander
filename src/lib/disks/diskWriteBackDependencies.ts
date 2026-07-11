/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { listFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { resolveFtpConnectionOptions } from "@/lib/ftp/ftpConfig";
import { base64ToUint8, uint8ToBase64 } from "@/lib/sid/sidUtils";
import type { DiskMountWriteBackDependencies } from "@/lib/disks/diskMount";

/**
 * FTP-backed disk write-back dependencies (list roots / read / write remote
 * files). Extracted from HomeDiskManager so the Play page's `executePlayPlan`
 * disk case can pass the SAME dependencies (HARD19-008): without them, mounting a
 * disk from Play dropped a Home-mounted disk's pending write-back (silently losing
 * in-game saves) instead of finalizing it.
 *
 * host/port/password are resolved fresh per call against the currently selected
 * device — never captured stale in a closure.
 */
export const buildDiskWriteBackDependencies = (): DiskMountWriteBackDependencies => ({
  listRemoteStorageRoots: async () => {
    const ftpOptions = await resolveFtpConnectionOptions();
    const result = await listFtpDirectory({ ...ftpOptions, path: "/" });
    return result.entries.filter((entry) => entry.type === "dir").map((entry) => entry.name);
  },
  readRemoteFile: async (path) => {
    const ftpOptions = await resolveFtpConnectionOptions();
    const result = await readFtpFile({ ...ftpOptions, path });
    return base64ToUint8(result.data);
  },
  writeRemoteFile: async (path, bytes) => {
    const ftpOptions = await resolveFtpConnectionOptions();
    await writeFtpFile({ ...ftpOptions, path, data: uint8ToBase64(bytes) });
  },
});
