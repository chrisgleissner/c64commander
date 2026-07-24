/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";

export const DEFAULT_AUTOFIRE_RATE_HZ = 5;
export const MIN_AUTOFIRE_RATE_HZ = 1;
export const MAX_AUTOFIRE_RATE_HZ = 10;

const AUTOFIRE_RATE_KEY = "c64u_remote_input_autofire_rate_hz";
const SHOW_AUTOFIRE_BUTTON_KEY = "c64u_remote_input_show_autofire";

/**
 * Autofire is rarely needed for C64 games and its control otherwise crowds the
 * game-mode action zone (overlapping the Live View picture). So the button is
 * hidden by default; a Settings toggle opts it back in.
 */
export const DEFAULT_SHOW_AUTOFIRE_BUTTON = false;

/** Broadcast when the "show autofire button" preference changes (parallels the rate event). */
export const AUTOFIRE_VISIBILITY_CHANGE_EVENT = "c64u-autofire-visibility-updated";

/**
 * Broadcast when the persisted autofire rate changes so a LIVE remote-input
 * session hot-swaps its ticking interval instead of only picking up the new
 * rate on its next mount — a user dragging the Settings slider while the sheet
 * is open would otherwise keep firing at the old rate until the sheet is
 * reopened.
 */
export const AUTOFIRE_RATE_CHANGE_EVENT = "c64u-autofire-rate-updated";

export const clampAutofireRateHz = (rateHz: number): number =>
  Math.min(MAX_AUTOFIRE_RATE_HZ, Math.max(MIN_AUTOFIRE_RATE_HZ, Math.round(rateHz)));

/** Persisted user preference (Settings → Remote Input) so a chosen rate survives across sessions. */
export const loadAutofireRateHz = (): number => {
  if (typeof localStorage === "undefined") return DEFAULT_AUTOFIRE_RATE_HZ;
  const raw = Number(localStorage.getItem(AUTOFIRE_RATE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampAutofireRateHz(raw) : DEFAULT_AUTOFIRE_RATE_HZ;
};

export const saveAutofireRateHz = (rateHz: number): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTOFIRE_RATE_KEY, String(clampAutofireRateHz(rateHz)));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTOFIRE_RATE_CHANGE_EVENT));
  }
};

/** Whether the game-mode Autofire button is shown (Settings → Remote Input). Default off. */
export const loadShowAutofireButton = (): boolean => {
  if (typeof localStorage === "undefined") return DEFAULT_SHOW_AUTOFIRE_BUTTON;
  const raw = localStorage.getItem(SHOW_AUTOFIRE_BUTTON_KEY);
  if (raw === null) return DEFAULT_SHOW_AUTOFIRE_BUTTON;
  return raw === "1";
};

export const saveShowAutofireButton = (show: boolean): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SHOW_AUTOFIRE_BUTTON_KEY, show ? "1" : "0");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTOFIRE_VISIBILITY_CHANGE_EVENT));
  }
};

/**
 * Applies the current autofire phase to a base held set: only ever removes
 * `fire` (during the "off" half of the duty cycle) when autofire is enabled
 * AND the base held set already holds `fire` (the user is holding the fire
 * button) - autofire never presses fire on its own. The phase itself is an
 * explicit boolean driven by a dedicated interval timer (see
 * `useRemoteInputSession`), not derived from elapsed time here - a session
 * previously computed "on/off" from `Date.now() % period`, sampled only
 * whenever the transport's coalesce-window flush happened to run, which
 * aliased against the ~40ms coalesce window at the default rate and could
 * settle on a single phase forever (autofire silently never firing).
 */
export const applyAutofirePhase = (
  baseHeldSet: HeldJoystickInputs,
  enabled: boolean,
  phaseOn: boolean,
): HeldJoystickInputs => {
  if (!enabled || phaseOn || !baseHeldSet.has("fire")) return baseHeldSet;
  const next = new Set(baseHeldSet);
  next.delete("fire");
  return next;
};
