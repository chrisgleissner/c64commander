/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardInputName, MachineInputEvent } from "@/lib/c64api";

export type HeldKeyboardInputs = ReadonlySet<KeyboardInputName>;

export const EMPTY_HELD_KEYBOARD_INPUTS: HeldKeyboardInputs = new Set();

/**
 * The keyboard counterpart to {@link heldSetDiffToInputBatch} (joystickHeldSet):
 * diffs two held-key sets into a coalesced batch — one `press` for newly-held
 * keys and one `release` for newly-released keys — so a key genuinely stays
 * asserted on the wire for as long as the user holds it, and a modifier held
 * alongside another key produces a real simultaneous chord instead of two
 * serialized one-shot taps.
 */
export const heldKeyboardSetDiffToInputBatch = (
  previous: HeldKeyboardInputs,
  next: HeldKeyboardInputs,
): MachineInputEvent[] => {
  const pressed = [...next].filter((input) => !previous.has(input));
  const released = [...previous].filter((input) => !next.has(input));
  const events: MachineInputEvent[] = [];
  if (pressed.length) {
    events.push({ kind: "keyboard", inputs: pressed, transition: "press" });
  }
  if (released.length) {
    events.push({ kind: "keyboard", inputs: released, transition: "release" });
  }
  return events;
};
