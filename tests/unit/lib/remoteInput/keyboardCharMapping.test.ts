/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  chunkMachineInputEvents,
  charToKeyboardInputEvents,
  KEYBOARD_INPUT_EVENT_MAX_KEYS,
  keyboardInputsToChar,
  MACHINE_INPUT_BATCH_MAX_EVENTS,
  stringToKeyboardInputEvents,
} from "@/lib/remoteInput/keyboardCharMapping";

describe("charToKeyboardInputEvents", () => {
  it("maps a lowercase letter to an unshifted tap", () => {
    expect(charToKeyboardInputEvents("a")).toEqual([{ kind: "keyboard", inputs: ["a"], transition: "tap" }]);
  });

  it("maps an uppercase letter to a shift+letter chord", () => {
    expect(charToKeyboardInputEvents("A")).toEqual([
      { kind: "keyboard", inputs: ["a", "left_shift"], transition: "tap" },
    ]);
  });

  it("maps digits directly", () => {
    expect(charToKeyboardInputEvents("7")).toEqual([{ kind: "keyboard", inputs: ["7"], transition: "tap" }]);
  });

  it("maps space, return, and backspace", () => {
    expect(charToKeyboardInputEvents(" ")).toEqual([{ kind: "keyboard", inputs: ["space"], transition: "tap" }]);
    expect(charToKeyboardInputEvents("\n")).toEqual([{ kind: "keyboard", inputs: ["return"], transition: "tap" }]);
    expect(charToKeyboardInputEvents("\b")).toEqual([{ kind: "keyboard", inputs: ["inst_del"], transition: "tap" }]);
  });

  it("maps an unshifted symbol with a direct C64 key", () => {
    expect(charToKeyboardInputEvents("@")).toEqual([{ kind: "keyboard", inputs: ["at"], transition: "tap" }]);
  });

  it("maps a shifted symbol to a chord with left_shift", () => {
    expect(charToKeyboardInputEvents("?")).toEqual([
      { kind: "keyboard", inputs: ["slash", "left_shift"], transition: "tap" },
    ]);
  });

  it("returns an empty array for a character with no C64 key equivalent, rather than guessing", () => {
    expect(charToKeyboardInputEvents("~")).toEqual([]);
    expect(charToKeyboardInputEvents("\\")).toEqual([]);
  });

  it("returns an empty array for a non-single-character input", () => {
    expect(charToKeyboardInputEvents("")).toEqual([]);
    expect(charToKeyboardInputEvents("ab")).toEqual([]);
  });

  it("every mapped chord stays within the 8-keys-per-event limit", () => {
    for (const char of "abcXYZ0123456789 \n\b@?<>[]") {
      const events = charToKeyboardInputEvents(char);
      events.forEach((event) => expect(event.inputs.length).toBeLessThanOrEqual(KEYBOARD_INPUT_EVENT_MAX_KEYS));
    }
  });
});

describe("stringToKeyboardInputEvents", () => {
  it("decomposes a whole string into one tap event per character", () => {
    expect(stringToKeyboardInputEvents("Hi!")).toEqual([
      { kind: "keyboard", inputs: ["h", "left_shift"], transition: "tap" },
      { kind: "keyboard", inputs: ["i"], transition: "tap" },
      // "!" has no clean C64 key equivalent — skipped, not guessed.
    ]);
  });

  it("skips unmappable characters without throwing", () => {
    expect(() => stringToKeyboardInputEvents("a~b")).not.toThrow();
    expect(stringToKeyboardInputEvents("a~b")).toEqual([
      { kind: "keyboard", inputs: ["a"], transition: "tap" },
      { kind: "keyboard", inputs: ["b"], transition: "tap" },
    ]);
  });
});

describe("keyboardInputsToChar", () => {
  it("is the exact inverse of charToKeyboardInputEvents for every mappable character", () => {
    // "\n"/"\r" both map to the same "return" key, so the inverse direction for
    // that one entry is an implementation detail — excluded from this loop.
    for (const char of "abcXYZ0123456789 @?<>[]") {
      const events = charToKeyboardInputEvents(char);
      if (!events.length) continue;
      expect(keyboardInputsToChar(events[0].inputs)).toBe(char);
    }
  });

  it("returns null for a chord with no ASCII equivalent (e.g. commodore/ctrl modifiers)", () => {
    expect(keyboardInputsToChar(["a", "commodore"])).toBeNull();
    expect(keyboardInputsToChar(["a", "ctrl"])).toBeNull();
    expect(keyboardInputsToChar(["a", "left_shift", "commodore"])).toBeNull();
  });

  it("returns null for an unmapped single key", () => {
    expect(keyboardInputsToChar(["f1"])).toBeNull();
  });
});

describe("chunkMachineInputEvents", () => {
  it("returns an empty array for no events", () => {
    expect(chunkMachineInputEvents([])).toEqual([]);
  });

  it("returns a single batch when under the cap", () => {
    const events = stringToKeyboardInputEvents("hello");
    expect(chunkMachineInputEvents(events)).toEqual([events]);
  });

  it("splits a long event list into batches of at most the max size", () => {
    const events = stringToKeyboardInputEvents("a".repeat(MACHINE_INPUT_BATCH_MAX_EVENTS + 5));
    const batches = chunkMachineInputEvents(events);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MACHINE_INPUT_BATCH_MAX_EVENTS);
    expect(batches[1]).toHaveLength(5);
    expect(batches.flat()).toEqual(events);
  });

  it("honors a custom batch size", () => {
    const events = stringToKeyboardInputEvents("abcde");
    const batches = chunkMachineInputEvents(events, 2);
    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
  });
});
