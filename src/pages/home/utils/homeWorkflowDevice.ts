/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import { listFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { listPopulatedStorageRoots } from "@/lib/ftp/storageRoots";
import { addLog, buildErrorLogDetails } from "@/lib/logging";
import { getPassword } from "@/lib/secureStorage";
import { base64ToUint8, uint8ToBase64 } from "@/lib/sid/sidUtils";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";

export type HomeWorkflowDevice = {
  host: string;
  ftpPort: number;
  telnetPort: number;
  password: Promise<string | null>;
};

/**
 * The device a Home REU or config file workflow runs against, resolved once when the workflow starts. Every FTP and
 * Telnet step of the workflow uses it, so a device switch mid-workflow cannot send later steps to the other device.
 */
export const bindHomeWorkflowDevice = (): HomeWorkflowDevice => {
  const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
  const password = getPassword();
  password.catch((error) => {
    addLog("warn", "Failed to read the password for a Home device workflow", buildErrorLogDetails(error, { host }));
  });
  return { host, ftpPort: getStoredFtpPort(), telnetPort: getStoredTelnetPort(), password };
};

export const buildHomeWorkflowFtpFiles = (device: HomeWorkflowDevice) => {
  const ftpOptions = async () => ({
    host: device.host,
    port: device.ftpPort,
    username: "user",
    password: (await device.password) ?? "",
  });
  return {
    listRemoteTempFiles: async () => {
      const result = await listFtpDirectory({ ...(await ftpOptions()), path: "/Temp" });
      return result.entries
        .filter((entry) => entry.type === "file")
        .map((entry) => ({ name: entry.name, path: entry.path, size: entry.size, modifiedAt: entry.modifiedAt }));
    },
    listRemoteStorageRoots: async () => {
      const options = await ftpOptions();
      return listPopulatedStorageRoots((path) => listFtpDirectory({ ...options, path }));
    },
    readRemoteFile: async (path: string) => {
      const result = await readFtpFile({ ...(await ftpOptions()), path });
      return base64ToUint8(result.data);
    },
    writeRemoteFile: async (path: string, bytes: Uint8Array) => {
      await writeFtpFile({ ...(await ftpOptions()), path, data: uint8ToBase64(bytes) });
    },
  };
};
