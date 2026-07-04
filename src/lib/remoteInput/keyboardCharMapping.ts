/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardInputName, MachineInputEvent, MachineInputKeyboardEvent } from "@/lib/c64api";

export const KEYBOARD_INPUT_EVENT_MAX_KEYS = 8;
export const MACHINE_INPUT_BATCH_MAX_EVENTS = 64;

/**
 * ASCII/Unicode chars with an unambiguous, well-documented C64 physical-key
 * equivalent, unshifted. `A`-`Z` and their shifted-symbol siblings are handled
 * separately below rather than duplicated here.
 */
const UNSHIFTED_CHAR_TO_KEY: Record<string, KeyboardInputName> = {
  " ": "space",
  "\n": "return",
  "\r": "return",
  "\b": "inst_del",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "+": "plus",
  "-": "minus",
  ".": "period",
  ":": "colon",
  "@": "at",
  ",": "comma",
  "*": "star",
  ";": "semicolon",
  "=": "equals",
  "/": "slash",
  "£": "pound",
  "↑": "arrow_up",
  "←": "arrow_left",
};

/** Shifted-symbol chars that are not the shifted form of a letter. */
const SHIFTED_CHAR_TO_KEY: Record<string, KeyboardInputName> = {
  "?": "slash",
  "<": "comma",
  ">": "period",
  "[": "colon",
  "]": "semicolon",
};

/**
 * Maps one input character to the C64 key(s) that must be held together to
 * produce it — a chord, per the u64e `machine:input` `KeyboardEvent.inputs`
 * contract (≤8 keys/event). We transmit key NAMES, not glyphs; the C64's
 * active charset mode (upper/graphics vs lower/upper) decides what actually
 * appears, exactly as it would for a physical key press — this mapping only
 * reproduces "which key(s), shifted or not" a physical keyboard user would
 * press for this character. Returns an empty array for characters with no
 * clean, unambiguous C64 physical-key equivalent (degrade silently rather
 * than guess wrong).
 */
export const charToKeyboardInputEvents = (char: string): MachineInputKeyboardEvent[] => {
  if (char.length !== 1) return [];
  if (char >= "a" && char <= "z") {
    return [{ kind: "keyboard", inputs: [char as KeyboardInputName], transition: "tap" }];
  }
  if (char >= "A" && char <= "Z") {
    return [{ kind: "keyboard", inputs: [char.toLowerCase() as KeyboardInputName, "left_shift"], transition: "tap" }];
  }
  const unshiftedKey = UNSHIFTED_CHAR_TO_KEY[char];
  if (unshiftedKey) {
    return [{ kind: "keyboard", inputs: [unshiftedKey], transition: "tap" }];
  }
  const shiftedKey = SHIFTED_CHAR_TO_KEY[char];
  if (shiftedKey) {
    return [{ kind: "keyboard", inputs: [shiftedKey, "left_shift"], transition: "tap" }];
  }
  return [];
};

/**
 * Decomposes a whole string into keyboard tap events, one chord per
 * character, skipping characters with no C64 key equivalent. Does not chunk
 * across the ≤64-events/batch cap — use {@link chunkMachineInputEvents} on
 * the result before sending.
 */
export const stringToKeyboardInputEvents = (text: string): MachineInputKeyboardEvent[] =>
  Array.from(text).flatMap((char) => charToKeyboardInputEvents(char));

const KEY_TO_UNSHIFTED_CHAR: Partial<Record<KeyboardInputName, string>> = Object.fromEntries(
  Object.entries(UNSHIFTED_CHAR_TO_KEY).map(([char, key]) => [key, char]),
);
const KEY_TO_SHIFTED_CHAR: Partial<Record<KeyboardInputName, string>> = Object.fromEntries(
  Object.entries(SHIFTED_CHAR_TO_KEY).map(([char, key]) => [key, char]),
);

/**
 * The inverse of {@link charToKeyboardInputEvents}: given a plain key chord
 * (a single key, optionally + `left_shift`), returns the character it
 * produces, or `null` when the chord has no ASCII equivalent (e.g. it
 * includes `commodore`/`ctrl`, which have no printable-range PETSCII byte and
 * so cannot round-trip through the kernal keyboard-buffer fallback tier).
 * Used by the on-screen keyboard to route a key press through the same
 * fallback-tier char path `sendChar` already uses, instead of duplicating it.
 */
const isLowercaseLetterKey = (key: KeyboardInputName): boolean => key.length === 1 && key >= "a" && key <= "z";

export const keyboardInputsToChar = (inputs: readonly KeyboardInputName[]): string | null => {
  if (inputs.length === 1) {
    const [key] = inputs;
    if (isLowercaseLetterKey(key)) return key;
    return KEY_TO_UNSHIFTED_CHAR[key] ?? null;
  }
  if (inputs.length === 2 && inputs.includes("left_shift")) {
    const key = inputs.find((input) => input !== "left_shift")!;
    if (isLowercaseLetterKey(key)) return key.toUpperCase();
    return KEY_TO_SHIFTED_CHAR[key] ?? null;
  }
  return null;
};

/** Splits an event list into ≤{@link MACHINE_INPUT_BATCH_MAX_EVENTS}-sized batches. */
export const chunkMachineInputEvents = (
  events: readonly MachineInputEvent[],
  maxPerBatch: number = MACHINE_INPUT_BATCH_MAX_EVENTS,
): MachineInputEvent[][] => {
  if (events.length === 0) return [];
  const batches: MachineInputEvent[][] = [];
  for (let offset = 0; offset < events.length; offset += maxPerBatch) {
    batches.push(events.slice(offset, offset + maxPerBatch));
  }
  return batches;
};
