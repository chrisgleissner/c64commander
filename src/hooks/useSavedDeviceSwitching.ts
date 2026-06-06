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
import { applyC64APIRuntimeConfig, buildBaseUrlFromDeviceHost } from "@/lib/c64api";
import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import { verifyCurrentConnectionTarget } from "@/lib/connection/connectionManager";
import { resetInteractionState } from "@/lib/deviceInteraction/deviceInteractionManager";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { addLog } from "@/lib/logging";
import { getSavedDeviceSwitchPrefixes, invalidateForSavedDeviceSwitch } from "@/lib/query/c64QueryInvalidation";
import { getPasswordForDevice } from "@/lib/secureStorage";
import {
  beginSavedDeviceSwitchAttempt,
  completeSavedDeviceSwitchAttempt,
  markSavedDeviceSwitchSelectionApplied,
  markSavedDeviceSwitchVerificationStarted,
} from "@/lib/savedDevices/savedDeviceSwitchMetrics";
import {
  completeSavedDeviceVerification,
  failSavedDeviceVerification,
  getSavedDeviceById,
  getSavedDeviceSwitchSummary,
  getSavedDevicesSnapshot,
  selectSavedDevice,
  startSavedDeviceVerification,
} from "@/lib/savedDevices/store";
import { buildSavedDevicePreferredRuntimeHost, getSavedDeviceResolvedAddress } from "@/lib/savedDevices/resolvedTarget";
import { setStoredTelnetPort } from "@/lib/telnet/telnetConfig";

let activeSavedDeviceSwitch: { deviceId: string; promise: Promise<unknown> } | null = null;

export function useSavedDeviceSwitching() {
  const queryClient = useQueryClient();
  const location = useLocation();

  const executeSavedDeviceSwitch = useCallback(
    async (deviceId: string) => {
      const fromDeviceId = getSavedDevicesSnapshot().selectedDeviceId;
      const device = getSavedDeviceById(deviceId);
      if (!device) {
        throw new Error(`Unknown saved device: ${deviceId}`);
      }

      const attemptId = beginSavedDeviceSwitchAttempt({
        fromDeviceId,
        toDeviceId: deviceId,
        routePath: location.pathname,
      });

      selectSavedDevice(deviceId);
      markSavedDeviceSwitchSelectionApplied(attemptId);
      setStoredFtpPort(device.ftpPort);
      setStoredTelnetPort(device.telnetPort);
      startSavedDeviceVerification(deviceId);
      resetInteractionState("saved-device-switch");

      const savedDeviceSwitchPrefixes = new Set(getSavedDeviceSwitchPrefixes(location.pathname));
      void queryClient
        .cancelQueries({
          predicate: (query) => savedDeviceSwitchPrefixes.has(String(query.queryKey[0] ?? "")),
        })
        .catch((error) => {
          addLog("warn", "Failed to cancel old-device C64 queries during saved-device switch", {
            deviceId,
            error: error instanceof Error ? error.message : String(error ?? "Unknown query cancellation failure"),
          });
        });

      const password = device.hasPassword ? await getPasswordForDevice(deviceId) : null;
      const deviceSummary = getSavedDeviceSwitchSummary(deviceId);
      const nextDeviceHost = buildDeviceHostWithHttpPort(device.host, device.httpPort);
      const preferredRuntimeHost = buildSavedDevicePreferredRuntimeHost(device, deviceSummary);
      const preferredResolvedAddress = getSavedDeviceResolvedAddress(deviceSummary);
      applyC64APIRuntimeConfig(
        buildBaseUrlFromDeviceHost(preferredRuntimeHost),
        password ?? undefined,
        preferredRuntimeHost,
        { reason: "saved-device-switch" },
      );

      markSavedDeviceSwitchVerificationStarted(attemptId);

      try {
        const verification = await verifyCurrentConnectionTarget({
          deviceHost: nextDeviceHost,
          password,
          preferResolvedAddress: preferredResolvedAddress,
        });
        if (verification.ok && verification.deviceInfo) {
          completeSavedDeviceVerification(deviceId, verification.deviceInfo, verification.resolvedAddress ?? null);
          invalidateForSavedDeviceSwitch(queryClient, location.pathname);
          completeSavedDeviceSwitchAttempt(attemptId, {
            outcome: "success",
            verification,
          });
        } else {
          failSavedDeviceVerification(deviceId);
          completeSavedDeviceSwitchAttempt(attemptId, {
            outcome: "offline",
            verification,
          });
        }
        return verification;
      } catch (error) {
        completeSavedDeviceSwitchAttempt(attemptId, {
          outcome: "error",
          errorMessage: error instanceof Error ? error.message : String(error ?? "Unknown switch failure"),
        });
        throw error;
      }
    },
    [location.pathname, queryClient],
  );

  return useCallback(
    async (deviceId: string) => {
      if (activeSavedDeviceSwitch) {
        if (activeSavedDeviceSwitch.deviceId === deviceId) {
          return activeSavedDeviceSwitch.promise;
        }

        addLog("info", "Saved-device switch request coalesced while another switch is in flight", {
          activeDeviceId: activeSavedDeviceSwitch.deviceId,
          requestedDeviceId: deviceId,
        });
        const queuedPromise = activeSavedDeviceSwitch.promise.then(
          () => executeSavedDeviceSwitch(deviceId),
          () => executeSavedDeviceSwitch(deviceId),
        );
        activeSavedDeviceSwitch = { deviceId, promise: queuedPromise };
        return queuedPromise.finally(() => {
          if (activeSavedDeviceSwitch?.promise === queuedPromise) {
            activeSavedDeviceSwitch = null;
          }
        });
      }
      const switchPromise = executeSavedDeviceSwitch(deviceId);
      activeSavedDeviceSwitch = { deviceId, promise: switchPromise };
      return await switchPromise.finally(() => {
        if (activeSavedDeviceSwitch?.promise === switchPromise) {
          activeSavedDeviceSwitch = null;
        }
      });
    },
    [executeSavedDeviceSwitch],
  );
}
