/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  INITIAL_LETTER_KEY_STATE,
  LETTER_RAIL_SLOT_PX,
  MIN_SCREENS_FOR_LETTER_RAIL,
  buildLetterIndex,
  isLetterRailEligible,
  letterAtRailFraction,
  letterForTitle,
  railFractionForLetter,
  railSlots,
  resolveDigitLetter,
  resolveTypedLetter,
} from "@/lib/lists/letterIndex";

const ALL_LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

describe("letterForTitle", () => {
  it.each([
    ["Arkanoid", "A"],
    ["  zoids", "Z"],
    ["Élite", "E"],
    ["1942", "#"],
    ["_intro", "#"],
    ["", "#"],
  ])("files %j under %s", (title, letter) => {
    expect(letterForTitle(title)).toBe(letter);
  });
});

describe("buildLetterIndex", () => {
  it("lists only the letters present, # first, and the first position of each", () => {
    const index = buildLetterIndex(["Zoids", "Arkanoid", "1942", "Alleykat", "Bubble"]);
    expect(index.letters).toEqual(["#", "A", "B", "Z"]);
    expect(index.firstIndexByLetter.get("A")).toBe(1);
    expect(index.firstIndexByLetter.get("Z")).toBe(0);
    expect(index.firstIndexByLetter.get("#")).toBe(2);
  });
});

describe("isLetterRailEligible", () => {
  const twoLetters = buildLetterIndex(["Alpha", "Beta"]);

  it("offers the rail from four screens of rows", () => {
    expect(isLetterRailEligible(twoLetters, MIN_SCREENS_FOR_LETTER_RAIL * 2, 100, 200)).toBe(true);
    expect(isLetterRailEligible(twoLetters, MIN_SCREENS_FOR_LETTER_RAIL * 2 - 1, 100, 200)).toBe(false);
  });

  it("needs at least two letters and a measured viewport", () => {
    expect(isLetterRailEligible(buildLetterIndex(["Alpha", "Avalon"]), 1000, 100, 200)).toBe(false);
    expect(isLetterRailEligible(twoLetters, 1000, 100, 0)).toBe(false);
  });
});

describe("letterAtRailFraction", () => {
  it("spreads every letter over the rail and clamps outside it", () => {
    expect(letterAtRailFraction(ALL_LETTERS, 0)).toBe("#");
    expect(letterAtRailFraction(ALL_LETTERS, -1)).toBe("#");
    expect(letterAtRailFraction(ALL_LETTERS, 1)).toBe("Z");
    expect(letterAtRailFraction(ALL_LETTERS, 2)).toBe("Z");
    expect(letterAtRailFraction(ALL_LETTERS, (16 + 0.5) / 27)).toBe("P");
    expect(letterAtRailFraction([], 0.5)).toBeNull();
  });

  it("is the inverse of railFractionForLetter", () => {
    for (const letter of ALL_LETTERS) {
      expect(letterAtRailFraction(ALL_LETTERS, railFractionForLetter(ALL_LETTERS, letter))).toBe(letter);
    }
  });
});

describe("railSlots", () => {
  it("draws every letter when they fit", () => {
    const slots = railSlots(ALL_LETTERS, ALL_LETTERS.length * LETTER_RAIL_SLOT_PX);
    expect(slots.map((slot) => (slot.kind === "letter" ? slot.letter : "•"))).toEqual(ALL_LETTERS);
  });

  it.each([48, 96, 122, 200, 300])("collapses to %ipx without overflowing, keeping the ends", (height) => {
    const slots = railSlots(ALL_LETTERS, height);
    expect(slots.length).toBeLessThanOrEqual(Math.floor(height / LETTER_RAIL_SLOT_PX));
    expect(slots[0]).toEqual({ kind: "letter", letter: "#" });
    expect(slots[slots.length - 1]).toEqual({ kind: "letter", letter: "Z" });
    slots.forEach((slot, position) => {
      if (slot.kind === "gap") expect(slots[position + 1]?.kind).toBe("letter");
    });
  });

  it("shows the iOS-style collapsed index for a 122px rail", () => {
    const slots = railSlots(ALL_LETTERS, 122);
    expect(slots.map((slot) => (slot.kind === "letter" ? slot.letter : "•")).join("")).toBe("#•I•Q•Z");
  });
});

describe("resolveDigitLetter", () => {
  const present = ["#", "A", "B", "C", "P", "R", "S"];

  it("multi-taps through the letters on a key", () => {
    const first = resolveDigitLetter(INITIAL_LETTER_KEY_STATE, 2, 1000, 800, present);
    expect(first.letter).toBe("A");
    const second = resolveDigitLetter(first.state, 2, 1500, 800, present);
    expect(second.letter).toBe("B");
    const third = resolveDigitLetter(second.state, 2, 2000, 800, present);
    expect(third.letter).toBe("C");
    expect(resolveDigitLetter(third.state, 2, 2500, 800, present).letter).toBe("A");
  });

  it("starts over after the multi-tap window or on another key", () => {
    const first = resolveDigitLetter(INITIAL_LETTER_KEY_STATE, 2, 1000, 800, present);
    expect(resolveDigitLetter(first.state, 2, 1801, 800, present).letter).toBe("A");
    expect(resolveDigitLetter(first.state, 7, 1100, 800, present).letter).toBe("P");
  });

  it("skips letters the list does not contain", () => {
    const first = resolveDigitLetter(INITIAL_LETTER_KEY_STATE, 7, 0, 800, present);
    expect(first.letter).toBe("P");
    expect(resolveDigitLetter(first.state, 7, 100, 800, present).letter).toBe("R");
    expect(resolveDigitLetter(INITIAL_LETTER_KEY_STATE, 9, 0, 800, present).letter).toBeNull();
  });

  it("files non-letter titles under 1", () => {
    expect(resolveDigitLetter(INITIAL_LETTER_KEY_STATE, 1, 0, 800, present).letter).toBe("#");
    expect(resolveDigitLetter(INITIAL_LETTER_KEY_STATE, 0, 0, 800, present).letter).toBeNull();
  });
});

describe("resolveTypedLetter", () => {
  const present = ["#", "B", "D", "M"];

  it("goes to the typed letter, or the next one present, or the last", () => {
    expect(resolveTypedLetter("d", present)).toBe("D");
    expect(resolveTypedLetter("C", present)).toBe("D");
    expect(resolveTypedLetter("a", present)).toBe("B");
    expect(resolveTypedLetter("z", present)).toBe("M");
  });

  it("ignores keys that are not letters", () => {
    expect(resolveTypedLetter("Enter", present)).toBeNull();
    expect(resolveTypedLetter("5", present)).toBeNull();
    expect(resolveTypedLetter("a", [])).toBeNull();
  });
});
