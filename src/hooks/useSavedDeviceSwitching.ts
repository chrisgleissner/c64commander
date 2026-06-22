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
import { setTraceDeviceAttributionContext } from "@/lib/tracing/traceContext";
import {
  beginSavedDeviceSwitchAttempt,
  completeSavedDeviceSwitchAttempt,
  markSavedDeviceSwitchSelectionApplied,
  markSavedDeviceSwitchVerificationStarted,
} from "@/lib/savedDevices/savedDeviceSwitchMetrics";
import {
  buildSavedDeviceDiagnosticsAttribution,
  completeSavedDeviceVerification,
  failSavedDeviceVerification,
  getSavedDeviceById,
  getSavedDevicesSnapshot,
  selectSavedDevice,
  startSavedDeviceVerification,
} from "@/lib/savedDevices/store";
import { setStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { clearToastsOnDeviceSwitch } from "@/lib/uiErrors";
import { setHealthCheckStateSnapshot } from "@/lib/diagnostics/healthCheckState";

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

      // Stale error toasts attributed to the device being switched away from
      // must not survive the switch (ERROR_POLICY §6).
      const fromDevice = fromDeviceId && fromDeviceId !== deviceId ? getSavedDeviceById(fromDeviceId) : null;
      if (fromDevice) {
        clearToastsOnDeviceSwitch(fromDevice.host);
        // BUG-036 — The comprehensive health-check result (latestResult) is a single
        // global slot with no target identity, and useHealthState applies its
        // overallHealth to whatever device is currently selected. Without clearing it
        // here, switching from a Healthy device to a different (e.g. unreachable) one
        // re-attributes the old device's "Healthy/green" to the new target until a
        // fresh comprehensive check runs. Invalidate it on a real device change so the
        // badge/health-card fall back to host-scoped trace-derived health.
        setHealthCheckStateSnapshot({ latestResult: null });
      }

      const attemptId = beginSavedDeviceSwitchAttempt({
        fromDeviceId,
        toDeviceId: deviceId,
        routePath: location.pathname,
      });

      setTraceDeviceAttributionContext(buildSavedDeviceDiagnosticsAttribution(device, null));
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
      const nextDeviceHost = buildDeviceHostWithHttpPort(device.host, device.httpPort);
      applyC64APIRuntimeConfig(buildBaseUrlFromDeviceHost(nextDeviceHost), password ?? undefined, nextDeviceHost, {
        reason: "saved-device-switch",
      });

      markSavedDeviceSwitchVerificationStarted(attemptId);

      try {
        const verification = await verifyCurrentConnectionTarget({
          deviceHost: nextDeviceHost,
          password,
        });
        if (verification.ok && verification.deviceInfo) {
          completeSavedDeviceVerification(deviceId, verification.deviceInfo);
          invalidateForSavedDeviceSwitch(queryClient, location.pathname);
          completeSavedDeviceSwitchAttempt(attemptId, {
            outcome: "success",
            verification,
          });
        } else {
          failSavedDeviceVerification(deviceId);
          invalidateForSavedDeviceSwitch(queryClient, location.pathname);
          completeSavedDeviceSwitchAttempt(attemptId, {
            outcome: "offline",
            verification,
          });
        }
        return verification;
      } catch (error) {
        invalidateForSavedDeviceSwitch(queryClient, location.pathname);
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
