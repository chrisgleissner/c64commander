/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { hasActiveInputRelease, releaseActiveRemoteInput } from "@/lib/remoteInput/activeInputRelease";
import { clearToastsOnDeviceSwitch } from "@/lib/uiErrors";
import { setHealthCheckStateSnapshot } from "@/lib/diagnostics/healthCheckState";
import { resetMachineExecution } from "@/lib/deviceInteraction/machineExecutionStore";
import { isBackgroundExecutionActive, stopBackgroundExecution } from "@/lib/native/backgroundExecutionManager";
import { BackgroundExecution } from "@/lib/native/backgroundExecution";
import { getSavedDeviceById } from "@/lib/savedDevices/store";
import { getRegisteredQueryClient } from "@/lib/query/queryClientRegistry";
import { invalidateForSavedDeviceSwitch } from "@/lib/query/c64QueryInvalidation";
import { toast } from "@/hooks/use-toast";

/**
 * Cross-device hygiene for any path that retargets the app from one device to
 * another. Extracted from `executeSavedDeviceSwitch` so a second switch path
 * cannot silently miss an accumulated fix (HARD19-012): the reachable-saved-device
 * fallback previously bypassed remote-input release, toast clearing, health-result
 * clearing, machine-execution reset, orphaned background-execution stop, and
 * device-scoped query invalidation.
 *
 * Ordering note: `executeSavedDeviceSwitch` deliberately keeps its own bespoke
 * sequencing because its steps are split around a fallible password resolve and
 * the API-retarget/verification boundary (HARD12-003, HARD16-009, HARD12-011), so
 * it does NOT route through this helper — its hygiene is the reference this helper
 * mirrors. Any future addition here (e.g. the HARD19-017 injection-queue drain)
 * must also be reflected in `executeSavedDeviceSwitch`.
 *
 * Safe to call pre-UI (during startup): every step tolerates uninitialised
 * singletons, and query invalidation is skipped when no client is registered yet.
 *
 * @param fromDeviceId the previously-selected device id (may be null on cold start)
 * @param toDeviceId   the device being retargeted to
 */
export async function prepareForDeviceRetarget(fromDeviceId: string | null, toDeviceId: string): Promise<void> {
  // 1. Release any Remote Input held on the OLD device FIRST, while the runtime
  //    API still targets it. Internally time-bounded and caught, so a dead old
  //    device cannot stall the retarget.
  if (hasActiveInputRelease()) {
    await releaseActiveRemoteInput();
  }

  const fromDevice = fromDeviceId && fromDeviceId !== toDeviceId ? getSavedDeviceById(fromDeviceId) : null;

  if (fromDevice) {
    // 2. Stale error toasts attributed to the old device must not survive (ERROR_POLICY §6).
    clearToastsOnDeviceSwitch(fromDevice.host);
    // 3. BUG-036: the comprehensive health-check result is a single global slot
    //    with no target identity; clear it so the old device's verdict is not
    //    re-attributed to the new target.
    setHealthCheckStateSnapshot({ latestResult: null });
  }

  // 4. HARD12-020: clear the shared machine pause/resume state so device A's
  //    "paused" state does not render for device B.
  resetMachineExecution();

  // 5. HARD18-011: stop any orphaned foreground background-execution service and
  //    clear the native auto-skip watchdog, so device A's watchdog cannot fire an
  //    auto-advance launch on device B.
  if (fromDevice && isBackgroundExecutionActive()) {
    try {
      await stopBackgroundExecution({ source: "device-retarget", reason: "device-retarget" });
    } catch (error) {
      addLog("warn", "Failed to stop orphaned background execution during device retarget", {
        toDeviceId,
        error: error instanceof Error ? error.message : String(error ?? "Unknown stop failure"),
      });
    }
    try {
      await BackgroundExecution.setDueAtMs({ dueAtMs: null });
    } catch (error) {
      addLog("warn", "Failed to clear native auto-skip due-time during device retarget", {
        toDeviceId,
        error: error instanceof Error ? error.message : String(error ?? "Unknown due-time clear failure"),
      });
    }
    toast({
      title: "Playback controls detached",
      description: "Background playback was stopped because the device changed.",
    });
  }

  // 6. HARD16-009: invalidate every device-scoped query so the new device's cards
  //    do not render device A's cached payloads. Skipped when no client is
  //    registered yet (very early startup, before any device query exists).
  const queryClient = getRegisteredQueryClient();
  if (queryClient) {
    invalidateForSavedDeviceSwitch(queryClient);
  }
}
