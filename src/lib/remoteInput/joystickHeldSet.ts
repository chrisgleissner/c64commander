/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { JoystickInputName, MachineInputEvent } from "@/lib/c64api";

export type HeldJoystickInputs = ReadonlySet<JoystickInputName>;

export const EMPTY_HELD_JOYSTICK_INPUTS: HeldJoystickInputs = new Set();

/**
 * Diffs two held-input sets into a coalesced batch: one `press` event for
 * newly-held inputs and one `release` event for newly-released inputs (never
 * more than two events, and never a bare release-all "blink" between them —
 * this is what makes the transport atomic per the HARD12-017 design). Returns
 * an empty array when nothing changed.
 */
export const heldSetDiffToInputBatch = (
  previous: HeldJoystickInputs,
  next: HeldJoystickInputs,
  port: 1 | 2,
): MachineInputEvent[] => {
  const pressed = [...next].filter((input) => !previous.has(input));
  const released = [...previous].filter((input) => !next.has(input));
  const events: MachineInputEvent[] = [];
  if (pressed.length) {
    events.push({ kind: "joystick", port, inputs: pressed, transition: "press" });
  }
  if (released.length) {
    events.push({ kind: "joystick", port, inputs: released, transition: "release" });
  }
  return events;
};

/**
 * The stuck-input safety net (HARD12-017): a single explicit event that
 * releases every currently-held keyboard and joystick input regardless of
 * client-side tracked state, sent on sheet close / mode switch / focus loss /
 * connection error and via the panic button.
 */
export const buildReleaseAllEvent = (): MachineInputEvent[] => [{ kind: "release_all" }];
