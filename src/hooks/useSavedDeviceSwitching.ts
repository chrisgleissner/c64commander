/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { buildBaseUrlFromDeviceHost, updateC64APIConfig } from "@/lib/c64api";
import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import { verifyCurrentConnectionTarget } from "@/lib/connection/connectionManager";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { invalidateForSavedDeviceSwitch } from "@/lib/query/c64QueryInvalidation";
import { getPasswordForDevice } from "@/lib/secureStorage";
import {
  completeSavedDeviceVerification,
  failSavedDeviceVerification,
  getSavedDeviceById,
  selectSavedDevice,
  startSavedDeviceVerification,
} from "@/lib/savedDevices/store";
import { setStoredTelnetPort } from "@/lib/telnet/telnetConfig";

export function useSavedDeviceSwitching() {
  const queryClient = useQueryClient();
  const location = useLocation();

  return useCallback(
    async (deviceId: string) => {
      const device = getSavedDeviceById(deviceId);
      if (!device) {
        throw new Error(`Unknown saved device: ${deviceId}`);
      }

      selectSavedDevice(deviceId);
      setStoredFtpPort(device.ftpPort);
      setStoredTelnetPort(device.telnetPort);
      startSavedDeviceVerification(deviceId);

      const password = device.hasPassword ? await getPasswordForDevice(deviceId) : null;
      const nextDeviceHost = buildDeviceHostWithHttpPort(device.host, device.httpPort);
      updateC64APIConfig(buildBaseUrlFromDeviceHost(nextDeviceHost), password ?? undefined, nextDeviceHost, {
        reason: "saved-device-switch",
      });

      const verification = await verifyCurrentConnectionTarget();
      if (verification.ok && verification.deviceInfo) {
        completeSavedDeviceVerification(deviceId, verification.deviceInfo);
        invalidateForSavedDeviceSwitch(queryClient, location.pathname);
      } else {
        failSavedDeviceVerification(deviceId);
      }
      return verification;
    },
    [location.pathname, queryClient],
  );
}
