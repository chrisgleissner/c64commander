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
import { resetInteractionState } from "@/lib/deviceInteraction/deviceInteractionManager";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { addLog } from "@/lib/logging";
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

const C64_QUERY_PREFIXES = new Set([
  "c64-info",
  "c64-drives",
  "c64-categories",
  "c64-category",
  "c64-config-item",
  "c64-config-items",
  "c64-all-config",
]);

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
      resetInteractionState("saved-device-switch");
      void queryClient
        .cancelQueries({
          predicate: (query) => C64_QUERY_PREFIXES.has(String(query.queryKey[0] ?? "")),
        })
        .catch((error) => {
          addLog("warn", "Failed to cancel old-device C64 queries during saved-device switch", {
            deviceId,
            error: error instanceof Error ? error.message : String(error ?? "Unknown query cancellation failure"),
          });
        });

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
