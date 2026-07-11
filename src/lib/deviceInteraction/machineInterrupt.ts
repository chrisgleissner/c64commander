/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64API } from "@/lib/c64api";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import {
  getMachineExecutionSnapshot,
  restorePauseMuteFromPersistedSnapshot,
  setMachineExecutionRunning,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { publishMachineTakeover, type MachineTakeoverReason } from "@/lib/deviceInteraction/machineTakeoverEvent";

/**
 * Single success-path helper for every Home action that interrupts or repurposes
 * the running machine (Reset, Power Off, Reboot, Reboot ClrMem, Power Cycle, and
 * snapshot / REU restore). It bundles the full machine-interrupt contract so no
 * present or future action can miss a piece:
 *
 *   1. If a pause-mute restore is pending (the user paused SID playback — which
 *      mutes the Audio Mixer via config writes — then triggered this action),
 *      restore the mixer from the persisted snapshot. Without this, a
 *      reset-while-paused strands the C64 audio silently muted (HARD19-032).
 *   2. Mark the shared machine-execution state "running" (unless the action
 *      deliberately leaves the machine paused, e.g. a RAM-only restore that
 *      honoured an existing pause).
 *   3. Publish the machine-takeover event so an armed Play session stops in place
 *      instead of auto-advancing over the reset/restored machine
 *      (HARD18-022 / HARD19-031 / HARD19-011).
 *
 * The state update (step 2) runs synchronously before the first await, so
 * fire-and-forget callers (`void publishMachineInterrupt(...)`) still get an
 * immediate UI state flip; the takeover and mixer restore complete in the
 * background. `getC64API()` / `getSelectedSavedDevice()` are read internally so
 * call sites stay one-liners. This never throws — `publishMachineTakeover` and
 * `restorePauseMuteFromPersistedSnapshot` swallow and log their own failures.
 *
 * Call ONLY after the underlying machine action succeeds (success-gated), exactly
 * like the three handlers HARD18-022 already fixed.
 */
export async function publishMachineInterrupt(options: {
  reason: MachineTakeoverReason;
  label: string;
  /** True when the action deliberately leaves the machine paused (RAM-only restore honouring a pause). */
  endsPaused?: boolean;
}): Promise<void> {
  const { reason, label, endsPaused = false } = options;

  // Capture the pending-restore decision BEFORE setMachineExecutionRunning clears
  // the flag. The persisted mixer snapshot itself outlives the flag until restored.
  const shouldRestorePauseMute = !endsPaused && getMachineExecutionSnapshot().pauseMutePending;

  if (!endsPaused) {
    setMachineExecutionRunning();
  }

  if (shouldRestorePauseMute) {
    await restorePauseMuteFromPersistedSnapshot(getC64API(), getSelectedSavedDevice()?.id ?? null);
  }

  await publishMachineTakeover({ reason, label });
}
