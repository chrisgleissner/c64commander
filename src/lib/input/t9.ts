/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * T9 multi-tap text composer — a pure, timer-free state machine.
 *
 * The composer never reads a clock itself: every mutating function takes a
 * `now` timestamp from the caller, which keeps it fully deterministic and
 * trivially unit-testable. A React/DOM adapter supplies `performance.now()`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Multi-tap table (mode "multitap", general text)
 * ──────────────────────────────────────────────────────────────────────────
 *   1 → . , ? ! - _ : /        6 → m n o 6
 *   2 → a b c 2                7 → p q r s 7
 *   3 → d e f 3                8 → t u v 8
 *   4 → g h i 4                9 → w x y z 9
 *   5 → j k l 5                0 → (space) 0
 *
 *   star  → toggle case of the last/pending character (configurable)
 *   hash  → cycle input mode (multitap ↔ hostname) (configurable)
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  Hostname mode (optimized for IP / hostname entry)
 * ──────────────────────────────────────────────────────────────────────────
 *   digits 0–9 → insert the digit DIRECTLY (no multi-tap), so IP octets are
 *                fast and the many "1"s in an address are trivial to type.
 *   star       → multi-tap separators: . : - _ /   (first tap = ".")
 *   hash       → switch to "multitap" to type letters, hash again to return.
 *
 *   How the canonical targets are typed (see t9.test.ts for executable proof):
 *     "192.168.1.13"        hostname: 1 9 2 ★ 1 6 8 ★ 1 ★ 1 3
 *                           (★ = star → ".")
 *     "192.168.1.13:8080"   …continue: ★★ (star twice → ":") 8 0 8 0
 *     "c64u"                multitap: 2·3 (c) 6·4 (6) 4·4 (4) 8·2 (u)
 *                           (n·k = press key n, k taps, then commit)
 *     "c64u.local"          multitap: c64u  1 (.)  5·3 (l) 6·3 (o)
 *                           2·3 (c) 2·1 (a) 5·3 (l)
 */

import { digitForAction, type SemanticAction } from "./keyEvent";

export type T9Mode = "multitap" | "hostname";

export type CursorDirection = "left" | "right";

export interface T9Pending {
  /** Source key: `0`–`9` for digits, or `-1` for the star punctuation key. */
  readonly key: number;
  readonly candidateIndex: number;
  readonly startedAt: number;
}

export interface T9State {
  readonly text: string;
  readonly cursor: number;
  readonly pending: T9Pending | null;
  readonly mode: T9Mode;
}

export interface T9Config {
  readonly multiTapTimeoutMs: number;
  /** Separators reachable via the star key (multi-tap), first is the default. */
  readonly hostnamePunctuation: readonly string[];
  /** Ordered modes the hash/`cycleMode` rotates through. */
  readonly modes: readonly T9Mode[];
}

/** Sentinel key id for the star-driven punctuation candidate list. */
export const STAR_KEY = -1;

/** General-text multi-tap candidates, indexed by digit. */
export const MULTITAP_CANDIDATES: Readonly<Record<number, readonly string[]>> = {
  0: [" ", "0"],
  1: [".", ",", "?", "!", "-", "_", ":", "/"],
  2: ["a", "b", "c", "2"],
  3: ["d", "e", "f", "3"],
  4: ["g", "h", "i", "4"],
  5: ["j", "k", "l", "5"],
  6: ["m", "n", "o", "6"],
  7: ["p", "q", "r", "s", "7"],
  8: ["t", "u", "v", "8"],
  9: ["w", "x", "y", "z", "9"],
};

export const DEFAULT_T9_CONFIG: T9Config = {
  multiTapTimeoutMs: 800,
  hostnamePunctuation: [".", ":", "-", "_", "/"],
  modes: ["multitap", "hostname"],
};

/** Merges partial config over the defaults. */
export const resolveT9Config = (config?: Partial<T9Config>): T9Config => ({
  multiTapTimeoutMs: config?.multiTapTimeoutMs ?? DEFAULT_T9_CONFIG.multiTapTimeoutMs,
  hostnamePunctuation: config?.hostnamePunctuation ?? DEFAULT_T9_CONFIG.hostnamePunctuation,
  modes: config?.modes ?? DEFAULT_T9_CONFIG.modes,
});

export interface CreateT9StateOptions {
  readonly text?: string;
  readonly mode?: T9Mode;
}

export const createT9State = (options: CreateT9StateOptions = {}): T9State => {
  const text = options.text ?? "";
  return {
    text,
    cursor: text.length,
    pending: null,
    mode: options.mode ?? "multitap",
  };
};

const insertAt = (text: string, cursor: number, ch: string): string => text.slice(0, cursor) + ch + text.slice(cursor);

const replaceAt = (text: string, index: number, ch: string): string =>
  text.slice(0, index) + ch + text.slice(index + 1);

const removeAt = (text: string, index: number): string => text.slice(0, index) + text.slice(index + 1);

const candidatesForKey = (key: number, config: T9Config): readonly string[] =>
  key === STAR_KEY ? config.hostnamePunctuation : (MULTITAP_CANDIDATES[key] ?? []);

const toggleCharCase = (ch: string): string => {
  const lower = ch.toLowerCase();
  const upper = ch.toUpperCase();
  if (lower === upper) return ch;
  return ch === lower ? upper : lower;
};

/** Clears the pending candidate without changing the text (it is committed). */
export const commitPending = (state: T9State): T9State => (state.pending ? { ...state, pending: null } : state);

/**
 * Generic multi-tap press for a candidate-bearing key. A repeated same-key
 * press inside the timeout cycles candidates in place; otherwise the prior
 * pending char is committed and a fresh candidate is inserted at the cursor.
 */
const multiTapPress = (state: T9State, key: number, now: number, config: T9Config): T9State => {
  const candidates = candidatesForKey(key, config);
  if (candidates.length === 0) return state;

  const pending = state.pending;
  const withinWindow = pending !== null && pending.key === key && now - pending.startedAt <= config.multiTapTimeoutMs;

  if (withinWindow && state.cursor > 0) {
    const nextIndex = (pending.candidateIndex + 1) % candidates.length;
    return {
      ...state,
      text: replaceAt(state.text, state.cursor - 1, candidates[nextIndex]),
      pending: { key, candidateIndex: nextIndex, startedAt: now },
    };
  }

  return {
    ...state,
    text: insertAt(state.text, state.cursor, candidates[0]),
    cursor: state.cursor + 1,
    pending: { key, candidateIndex: 0, startedAt: now },
  };
};

/** Commits any pending candidate, then inserts a literal character. */
const directInsert = (state: T9State, ch: string): T9State => {
  const committed = commitPending(state);
  return {
    ...committed,
    text: insertAt(committed.text, committed.cursor, ch),
    cursor: committed.cursor + 1,
  };
};

/**
 * Presses a digit key.
 *  - multitap mode → multi-tap over {@link MULTITAP_CANDIDATES}.
 *  - hostname mode → insert the digit directly (no multi-tap).
 */
export const pressDigit = (
  state: T9State,
  digit: number,
  now: number,
  config: T9Config = DEFAULT_T9_CONFIG,
): T9State => {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return state;
  if (state.mode === "hostname") {
    return directInsert(state, String(digit));
  }
  return multiTapPress(state, digit, now, config);
};

/** Star key. Multi-taps the hostname separator list (works in both modes). */
export const pressPunctuation = (state: T9State, now: number, config: T9Config = DEFAULT_T9_CONFIG): T9State =>
  multiTapPress(state, STAR_KEY, now, config);

/**
 * Toggles the case of the current (pending or last committed) character and
 * commits, so a subsequent same-key press starts a new character.
 */
export const toggleCase = (state: T9State): T9State => {
  const index = state.cursor - 1;
  if (index < 0) return state;
  return {
    ...state,
    text: replaceAt(state.text, index, toggleCharCase(state.text[index])),
    pending: null,
  };
};

/**
 * Delete: drops the pending candidate first; otherwise removes the committed
 * character to the left of the cursor.
 */
export const pressDelete = (state: T9State): T9State => {
  if (state.cursor <= 0) {
    return state.pending ? { ...state, pending: null } : state;
  }
  return {
    ...state,
    text: removeAt(state.text, state.cursor - 1),
    cursor: state.cursor - 1,
    pending: null,
  };
};

/** Commits any pending candidate, then moves the cursor one step (clamped). */
export const moveCursor = (state: T9State, direction: CursorDirection): T9State => {
  const committed = commitPending(state);
  const delta = direction === "left" ? -1 : 1;
  const cursor = Math.max(0, Math.min(committed.text.length, committed.cursor + delta));
  return { ...committed, cursor };
};

/** Cycles the input mode (e.g. multitap ↔ hostname), committing first. */
export const cycleMode = (state: T9State, config: T9Config = DEFAULT_T9_CONFIG): T9State => {
  const committed = commitPending(state);
  const modes = config.modes.length > 0 ? config.modes : DEFAULT_T9_CONFIG.modes;
  const currentIndex = modes.indexOf(committed.mode);
  const nextMode = modes[(currentIndex + 1) % modes.length];
  return { ...committed, mode: nextMode };
};

/** Sets a specific mode, committing first. No-op if the mode is unchanged. */
export const setMode = (state: T9State, mode: T9Mode): T9State => {
  const committed = commitPending(state);
  return committed.mode === mode ? committed : { ...committed, mode };
};

/** Replaces the whole buffer; cursor goes to the end, pending cleared. */
export const setText = (state: T9State, text: string): T9State => ({
  text,
  cursor: text.length,
  pending: null,
  mode: state.mode,
});

/**
 * Bridges a {@link SemanticAction} onto the composer. This is the single entry
 * point UI code uses, so components never call the lower-level reducers
 * directly. Unmapped actions return the state unchanged.
 */
export const applySemanticAction = (
  state: T9State,
  action: SemanticAction,
  now: number,
  config: T9Config = DEFAULT_T9_CONFIG,
): T9State => {
  const digit = digitForAction(action);
  if (digit !== null) {
    return pressDigit(state, digit, now, config);
  }

  switch (action) {
    case "star":
      return state.mode === "hostname" ? pressPunctuation(state, now, config) : toggleCase(state);
    case "hash":
    case "toggleInputMode":
      return cycleMode(state, config);
    case "delete":
      return pressDelete(state);
    case "dpadLeft":
      return moveCursor(state, "left");
    case "dpadRight":
      return moveCursor(state, "right");
    case "enter":
    case "center":
    case "activate":
      return commitPending(state);
    default:
      return state;
  }
};
