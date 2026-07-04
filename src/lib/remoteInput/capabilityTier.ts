/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MachineInputCapabilityStatus } from "@/lib/deviceCapabilities";

/**
 * HARD12-017 capability tiers, derived from the `machine:input` probe status:
 * - `full`: U64-family + `machine:input` 200 — Joystick and Type both relay
 *   over REST, all four input methods.
 * - `kernal-fallback`: U64-family + 501 (route present, no input hardware),
 *   current c64u 1.1.0 / older firmware (404/405), or U2 (no endpoint at
 *   all) — Type only, via the HARD12-008 chunked kernal keyboard-buffer
 *   injection. Joystick is unavailable; the sheet must say so, never hide it
 *   silently.
 * - `auth-required`: the probe could not complete without a password: treat
 *   the same as `kernal-fallback` until authenticated (never assume full).
 */
export type RemoteInputTier = "full" | "kernal-fallback" | "auth-required";

export const resolveRemoteInputTier = (status: MachineInputCapabilityStatus): RemoteInputTier => {
  switch (status) {
    case "available":
      return "full";
    case "auth-required":
      return "auth-required";
    case "hardware-unavailable":
    case "unsupported-family":
    case "missing":
    case "error":
      return "kernal-fallback";
  }
};

export const remoteInputSupportsJoystick = (tier: RemoteInputTier): boolean => tier === "full";

export const REMOTE_INPUT_JOYSTICK_UNAVAILABLE_HINT =
  "Joystick relay requires Ultimate firmware with machine:input support. Type mode still works.";
