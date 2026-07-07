/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from "@/lib/logging";
import { isBackgroundExecutionActive, stopBackgroundExecution } from "@/lib/native/backgroundExecutionManager";

// HARD18-022/023 (M3): published by USER-INITIATED whole-machine resets
// (Home reboot / reboot-clear-memory / power-cycle) and out-of-playlist
// launches (CommoServe Run / Mount & run) that reset or repurpose the C64
// out from under an armed Play session - never by Play's own playItem
// reboot. The Play page stays mounted for the app's lifetime (background
// execution/native auto-advance watchdog survive tab navigation by design),
// so its subscriber reliably hears every takeover; this module additionally
// stops any orphaned background-execution session unconditionally, at the
// infrastructure level, so a takeover is still handled correctly even if no
// Play subscriber happens to be registered (mirrors HARD18-011).
export type MachineTakeoverReason = "home-reset" | "external-launch";

export type MachineTakeoverEvent = {
  reason: MachineTakeoverReason;
  label: string;
};

type MachineTakeoverListener = (event: MachineTakeoverEvent) => void;

const listeners = new Set<MachineTakeoverListener>();

export const subscribeMachineTakeover = (listener: MachineTakeoverListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const publishMachineTakeover = async (event: MachineTakeoverEvent): Promise<void> => {
  listeners.forEach((listener) => listener(event));
  if (!isBackgroundExecutionActive()) return;
  try {
    await stopBackgroundExecution({ source: "machine-takeover", reason: event.reason });
  } catch (error) {
    addErrorLog("Failed to stop background execution after machine takeover", {
      reason: event.reason,
      label: event.label,
      error: (error as Error).message,
    });
  }
};
