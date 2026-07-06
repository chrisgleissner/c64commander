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

const canonicalChordKey = (inputs: readonly KeyboardInputName[]): string => [...inputs].sort().join("+");

/**
 * Collapses a same-chord press immediately followed by its own release -
 * both still queued, neither flushed yet - into a single `tap` event.
 *
 * Firmware ground truth (1541ultimate route_input.cc/keyboard_usb.cc): a
 * `press` and `release` shipped in one request apply back-to-back with zero
 * delay (microseconds), nowhere near the KERNAL's ~16.7ms matrix scan
 * interval, so the C64 can miss it entirely. `tap` is a dedicated firmware
 * mechanism that holds the key for a real 60ms via its own timer, which is
 * what actually guarantees registration for a press this fast. A genuine
 * hold (whose release lands in a LATER, separate flush after real time has
 * passed) never reaches this function with both halves present, so it is
 * untouched - only a same-batch press+release pair collapses.
 */
export const collapseTransientKeyboardTaps = (events: readonly MachineInputEvent[]): MachineInputEvent[] => {
  const result: MachineInputEvent[] = [];
  const openPressIndexByChord = new Map<string, number>();

  for (const event of events) {
    if (event.kind !== "keyboard" || event.transition === "tap") {
      result.push(event);
      continue;
    }
    const chordKey = canonicalChordKey(event.inputs);
    if (event.transition === "press") {
      openPressIndexByChord.set(chordKey, result.length);
      result.push(event);
      continue;
    }
    // transition === "release"
    const openIndex = openPressIndexByChord.get(chordKey);
    if (openIndex === undefined) {
      result.push(event); // releasing a chord held since a previous flush
      continue;
    }
    openPressIndexByChord.delete(chordKey);
    const openPress = result[openIndex] as Extract<MachineInputEvent, { kind: "keyboard" }>;
    result[openIndex] = { ...openPress, transition: "tap" };
    // Drop the release: the tap event's own firmware-timed hold covers it.
  }

  return result;
};
