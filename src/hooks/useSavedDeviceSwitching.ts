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
import { verifyCurrentConnectionTarget, setSavedDeviceSwitchProbeWindow } from "@/lib/connection/connectionManager";
import { resetInteractionState } from "@/lib/deviceInteraction/deviceInteractionManager";
import { resetMachineExecution } from "@/lib/deviceInteraction/machineExecutionStore";
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
import { hasActiveInputRelease, releaseActiveRemoteInput } from "@/lib/remoteInput/activeInputRelease";
import { drainKernalFallbackInjectionQueue } from "@/lib/remoteInput/kernalFallbackInjector";
import { isBackgroundExecutionActive, stopBackgroundExecution } from "@/lib/native/backgroundExecutionManager";
import { BackgroundExecution } from "@/lib/native/backgroundExecution";
import { avMirrorSession } from "@/lib/streams/avMirrorSession";
import { toast } from "@/hooks/use-toast";

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

      // HARD13-001 residual (E1): release any Remote Input held on the OLD
      // device FIRST, while `getC64API()` still targets it - otherwise the
      // eventual release-all fires against the NEW device and the old one
      // keeps the input pressed. Internally caught and time-bounded (see
      // activeInputRelease.ts), so a dead old device cannot stall the switch;
      // this is the one deliberately fail-safe step allowed ahead of the
      // HARD12-003 password resolve below. Skip the await entirely when no
      // session is mounted - nothing to release, no reason to suspend.
      if (hasActiveInputRelease()) {
        await releaseActiveRemoteInput();
      }

      // HARD19-017: cancel any queued/in-flight kernal-fallback keyboard-buffer
      // injections so remaining PETSCII writes cannot land on the new device.
      // (prepareForDeviceRetarget does this for the fallback switch path; the
      // canonical switch keeps its own bespoke ordering, so it drains here too.)
      drainKernalFallbackInjectionQueue();

      // HARD12-003: resolve the password (the only fallible step before the API
      // retarget) BEFORE any selection/port/verification mutation. A native
      // SecureStorage rejection here aborts the switch with nothing half-applied
      // — the saved-device store, ports, and runtime API config all still target
      // the previous device, so the UI and the control plane cannot diverge into
      // the "selected=new / API=old" state.
      const password = device.hasPassword ? await getPasswordForDevice(deviceId) : null;

      // Live View clean-transition: both devices stream A/V to the SAME multicast group, so the
      // OLD device must be told to stop BEFORE we retarget the API — otherwise it keeps streaming
      // there and, once the mirror follows to the new device, the receiver sees interleaved frames
      // from BOTH devices (corrupt video, no clean switch). Stop here while getC64API() still
      // targets the old device; re-start on the new device after it verifies. Bounded so a dead
      // old device cannot stall the switch.
      const liveViewVideoWasActive = avMirrorSession.videoLive;
      const liveViewAudioWasActive = avMirrorSession.audioLive;
      if (liveViewVideoWasActive || liveViewAudioWasActive) {
        await Promise.race([avMirrorSession.stopAll(), new Promise((resolve) => setTimeout(resolve, 1500))]).catch(
          () => {},
        );
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
      const nextDeviceHost = buildDeviceHostWithHttpPort(device.host, device.httpPort);
      // HARD12-011: open the switch window around selectSavedDevice →
      // applyC64APIRuntimeConfig so a late /v1/info from the previous device
      // cannot restamp the newly selected device's identity while the runtime
      // API config still targets the old host.
      setSavedDeviceSwitchProbeWindow(true);
      try {
        selectSavedDevice(deviceId);
        markSavedDeviceSwitchSelectionApplied(attemptId);
        setStoredFtpPort(device.ftpPort);
        setStoredTelnetPort(device.telnetPort);
        startSavedDeviceVerification(deviceId);
        resetInteractionState("saved-device-switch");
        // HARD12-020: the shared machine pause/resume state (written by both
        // Play and Home) must not carry device A's pause state onto device B
        // — Home may be the only mounted page during a switch, so this is the
        // single choke point that always runs regardless of which page is up.
        resetMachineExecution();

        // HARD18-011: a saved-device switch while Play is unmounted (idle
        // placeholder) left no code path allowed to stop the foreground
        // background-execution service or clear the native auto-advance
        // watchdog — orphaning the wake lock until process death. This is
        // the one choke point that always runs regardless of which page is
        // mounted, mirroring resetMachineExecution above. Fixed here in the
        // switch flow, not by relaxing PlayFilesPage's
        // hasObservedActivePlaybackRef guard (BUG-040/025 stay intact).
        if (fromDevice && isBackgroundExecutionActive()) {
          try {
            await stopBackgroundExecution({ source: "saved-device-switch", reason: "saved-device-switch" });
          } catch (error) {
            addLog("warn", "Failed to stop orphaned background execution during saved-device switch", {
              deviceId,
              error: error instanceof Error ? error.message : String(error ?? "Unknown stop failure"),
            });
          }
          try {
            await BackgroundExecution.setDueAtMs({ dueAtMs: null });
          } catch (error) {
            addLog("warn", "Failed to clear native auto-skip due-time during saved-device switch", {
              deviceId,
              error: error instanceof Error ? error.message : String(error ?? "Unknown due-time clear failure"),
            });
          }
          toast({
            title: "Playback controls detached",
            description: "Background playback was stopped because the device changed.",
          });
        }

        const savedDeviceSwitchPrefixes = new Set<string>(getSavedDeviceSwitchPrefixes(location.pathname));
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

        applyC64APIRuntimeConfig(buildBaseUrlFromDeviceHost(nextDeviceHost), password ?? undefined, nextDeviceHost, {
          reason: "saved-device-switch",
        });
      } finally {
        setSavedDeviceSwitchProbeWindow(false);
      }

      markSavedDeviceSwitchVerificationStarted(attemptId);

      try {
        const verification = await verifyCurrentConnectionTarget({
          deviceHost: nextDeviceHost,
          password,
        });
        if (verification.ok && verification.deviceInfo) {
          completeSavedDeviceVerification(deviceId, verification.deviceInfo);
          invalidateForSavedDeviceSwitch(queryClient);
          // Follow Live View to the now-verified new device (single clean source). Fire-and-forget
          // so a slow streams:start cannot delay the switch resolving; startVideo/startAudio bind a
          // fresh receiver and issue streams:start on the new device.
          if (liveViewVideoWasActive) void avMirrorSession.startVideo().catch(() => {});
          if (liveViewAudioWasActive) void avMirrorSession.startAudio().catch(() => {});
          completeSavedDeviceSwitchAttempt(attemptId, {
            outcome: "success",
            verification,
          });
        } else {
          failSavedDeviceVerification(deviceId);
          invalidateForSavedDeviceSwitch(queryClient);
          completeSavedDeviceSwitchAttempt(attemptId, {
            outcome: "offline",
            verification,
          });
        }
        return verification;
      } catch (error) {
        invalidateForSavedDeviceSwitch(queryClient);
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
