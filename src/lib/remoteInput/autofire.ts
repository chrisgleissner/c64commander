/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";

export type AutofireConfig = {
  enabled: boolean;
  rateHz: number;
  /** Timestamp the autofire toggle (or the fire press it rides on) started. */
  startedAtMs: number;
};

export const DEFAULT_AUTOFIRE_RATE_HZ = 10;

/**
 * Client-side timed press/release cycle for autofire: a 50% duty-cycle square
 * wave over the held set's `fire` input, computed purely from elapsed time so
 * it is deterministic and unit-testable without timers. Only affects `fire`
 * when autofire is enabled AND the base held set already holds `fire` (the
 * user is holding the fire button) — autofire never presses fire on its own.
 */
export const autofireCycle = (
  baseHeldSet: HeldJoystickInputs,
  autofire: AutofireConfig,
  nowMs: number,
): HeldJoystickInputs => {
  if (!autofire.enabled || !baseHeldSet.has("fire")) return baseHeldSet;
  const rateHz = Math.max(autofire.rateHz, 0.1);
  const periodMs = 1000 / rateHz;
  const elapsedMs = Math.max(0, nowMs - autofire.startedAtMs);
  const phaseOn = elapsedMs % periodMs < periodMs / 2;
  if (phaseOn) return baseHeldSet;
  const next = new Set(baseHeldSet);
  next.delete("fire");
  return next;
};
