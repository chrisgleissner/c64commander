/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { MULTITAP_CANDIDATES } from "@/lib/input/t9";

/** The rail entry for every title that does not start with a letter A to Z. */
export const NON_LETTER_KEY = "#";

/**
 * A list shorter than this many screens of rows is quicker to scroll than to index. Android's
 * FastScroller uses the same four-page threshold before it offers its thumb.
 */
export const MIN_SCREENS_FOR_LETTER_RAIL = 4;

/** Rail pitch per letter: the 14 px text floor plus the space a finger needs to tell letters apart. */
export const LETTER_RAIL_SLOT_PX = 16;

export type LetterIndex = {
  /** Letters that occur in the list, `#` first, then A to Z. */
  readonly letters: readonly string[];
  /** For each letter, the position of the first title that starts with it. */
  readonly firstIndexByLetter: ReadonlyMap<string, number>;
};

export type RailSlot = { readonly kind: "letter"; readonly letter: string } | { readonly kind: "gap" };

export const letterForTitle = (title: string): string => {
  const first = title.trim().normalize("NFD").charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : NON_LETTER_KEY;
};

export const buildLetterIndex = (titles: readonly string[]): LetterIndex => {
  const firstIndexByLetter = new Map<string, number>();
  titles.forEach((title, index) => {
    const letter = letterForTitle(title);
    if (!firstIndexByLetter.has(letter)) firstIndexByLetter.set(letter, index);
  });
  const letters = [...firstIndexByLetter.keys()].sort((left, right) => {
    if (left === NON_LETTER_KEY) return -1;
    if (right === NON_LETTER_KEY) return 1;
    return left.localeCompare(right);
  });
  return { letters, firstIndexByLetter };
};

export const isLetterRailEligible = (
  index: LetterIndex,
  itemCount: number,
  estimatedItemHeightPx: number,
  viewportHeightPx: number,
): boolean =>
  index.letters.length >= 2 &&
  viewportHeightPx > 0 &&
  itemCount * estimatedItemHeightPx >= MIN_SCREENS_FOR_LETTER_RAIL * viewportHeightPx;

/** The letter under a point `fraction` of the way down the rail, over every letter, shown or not. */
export const letterAtRailFraction = (letters: readonly string[], fraction: number): string | null => {
  if (letters.length === 0) return null;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return letters[Math.min(letters.length - 1, Math.floor(clamped * letters.length))] ?? null;
};

/** Where a letter sits on the rail, as the fraction of its height at the centre of the letter's band. */
export const railFractionForLetter = (letters: readonly string[], letter: string): number => {
  const position = letters.indexOf(letter);
  if (position < 0 || letters.length === 0) return 0.5;
  return (position + 0.5) / letters.length;
};

/**
 * The letters a rail of `heightPx` can draw at `slotPx` each. When they do not all fit, evenly spaced
 * letters alternate with gap marks, always keeping the first and the last, as the iOS section index
 * does. A drag still resolves to every letter through {@link letterAtRailFraction}.
 */
export const railSlots = (letters: readonly string[], heightPx: number, slotPx = LETTER_RAIL_SLOT_PX): RailSlot[] => {
  const all = letters.map((letter): RailSlot => ({ kind: "letter", letter }));
  const capacity = Math.floor(heightPx / slotPx);
  if (letters.length <= Math.max(capacity, 2)) return all;
  const shownCount = Math.max(2, Math.floor((capacity + 1) / 2));
  const positions = [
    ...new Set(Array.from({ length: shownCount }, (_, i) => Math.round((i * (letters.length - 1)) / (shownCount - 1)))),
  ];
  const slots: RailSlot[] = [];
  positions.forEach((position, i) => {
    if (i > 0 && position - positions[i - 1] > 1) slots.push({ kind: "gap" });
    slots.push({ kind: "letter", letter: letters[position] });
  });
  return slots;
};

const LETTERS_BY_DIGIT: Readonly<Record<number, readonly string[]>> = Object.fromEntries(
  Object.entries(MULTITAP_CANDIDATES).map(([digit, candidates]) => [
    Number(digit),
    Number(digit) === 1
      ? [NON_LETTER_KEY]
      : candidates.filter((candidate) => /^[a-z]$/.test(candidate)).map((candidate) => candidate.toUpperCase()),
  ]),
);

export type LetterKeyState = { readonly digit: number | null; readonly letter: string | null; readonly at: number };

export const INITIAL_LETTER_KEY_STATE: LetterKeyState = { digit: null, letter: null, at: 0 };

/**
 * Multi-tap over the letters a digit carries, as a keypad phone's contact list does: `2` goes to A,
 * `2` again within the multi-tap window goes to B. Letters the list does not contain are skipped.
 */
export const resolveDigitLetter = (
  state: LetterKeyState,
  digit: number,
  now: number,
  multiTapTimeoutMs: number,
  present: readonly string[],
): { state: LetterKeyState; letter: string | null } => {
  const candidates = (LETTERS_BY_DIGIT[digit] ?? []).filter((letter) => present.includes(letter));
  if (candidates.length === 0) return { state: INITIAL_LETTER_KEY_STATE, letter: null };
  const continuing = state.digit === digit && now - state.at <= multiTapTimeoutMs;
  const previous = continuing && state.letter !== null ? candidates.indexOf(state.letter) : -1;
  const letter = candidates[(previous + 1) % candidates.length];
  return { state: { digit, letter, at: now }, letter };
};

/** A typed letter goes to that letter, or to the next one the list contains when it has none. */
export const resolveTypedLetter = (key: string, present: readonly string[]): string | null => {
  if (!/^[a-z]$/i.test(key) || present.length === 0) return null;
  const wanted = key.toUpperCase();
  return present.find((letter) => letter !== NON_LETTER_KEY && letter >= wanted) ?? present[present.length - 1];
};

export type LetterIndexEntry = { readonly id: string; readonly title: string };

/**
 * Every item a paged list would show, loaded or not, so the rail can index the whole list and ask for
 * the page holding a letter before it jumps there.
 */
export type LetterIndexSource = {
  /** Built when a rail needs it, not on every change of the underlying list. */
  readonly getEntries: () => readonly LetterIndexEntry[];
  /** Asks the list to load at least this many items. */
  readonly ensureLoaded: (count: number) => void;
};
