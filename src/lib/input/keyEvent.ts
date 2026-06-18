/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Key-event normalization.
 *
 * The rest of the input subsystem (and every UI consumer) speaks in
 * {@link SemanticAction}s, never raw browser/Android key codes. This module is
 * the single place that turns a {@link KeyEventLike} into a semantic action by
 * consulting a data-driven {@link Keymap}. Mapping lives in the keymap/profiles,
 * not here, so it stays colocated and configurable.
 */

import type { Keymap, KeyBinding } from "./keymap";

/**
 * The complete set of semantic actions the input subsystem understands. UI
 * components subscribe to these instead of inspecting raw key codes.
 */
export type SemanticAction =
  | "digit0"
  | "digit1"
  | "digit2"
  | "digit3"
  | "digit4"
  | "digit5"
  | "digit6"
  | "digit7"
  | "digit8"
  | "digit9"
  | "star"
  | "hash"
  | "dpadUp"
  | "dpadDown"
  | "dpadLeft"
  | "dpadRight"
  | "center"
  | "softLeft"
  | "softRight"
  | "back"
  | "delete"
  | "enter"
  | "escape"
  | "nextField"
  | "previousField"
  | "activate"
  | "openMenu"
  | "closeMenu"
  | "toggleInputMode";

/** Every {@link SemanticAction}, useful for exhaustiveness checks and tests. */
export const SEMANTIC_ACTIONS: readonly SemanticAction[] = [
  "digit0",
  "digit1",
  "digit2",
  "digit3",
  "digit4",
  "digit5",
  "digit6",
  "digit7",
  "digit8",
  "digit9",
  "star",
  "hash",
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
  "center",
  "softLeft",
  "softRight",
  "back",
  "delete",
  "enter",
  "escape",
  "nextField",
  "previousField",
  "activate",
  "openMenu",
  "closeMenu",
  "toggleInputMode",
];

const DIGIT_ACTIONS: readonly SemanticAction[] = [
  "digit0",
  "digit1",
  "digit2",
  "digit3",
  "digit4",
  "digit5",
  "digit6",
  "digit7",
  "digit8",
  "digit9",
];

/** True when the action is one of `digit0`..`digit9`. */
export const isDigitAction = (action: SemanticAction): boolean => DIGIT_ACTIONS.includes(action);

/** Maps `digitN` to its numeric value, or `null` for non-digit actions. */
export const digitForAction = (action: SemanticAction): number | null => {
  const index = DIGIT_ACTIONS.indexOf(action);
  return index >= 0 ? index : null;
};

export interface KeyModifiers {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

/**
 * The structural subset of `KeyboardEvent` we depend on. A real
 * `KeyboardEvent` is assignable to this, and tests can build plain objects.
 */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly keyCode?: number;
  readonly repeat?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface NormalizedKeyEvent {
  /** Resolved semantic action, or `null` when the key is not bound. */
  readonly action: SemanticAction | null;
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly modifiers: KeyModifiers;
  readonly raw: KeyEventLike;
}

const modifierMatches = (binding: KeyBinding, event: KeyEventLike): boolean => {
  if (binding.shift !== undefined && Boolean(event.shiftKey) !== binding.shift) {
    return false;
  }
  if (binding.alt !== undefined && Boolean(event.altKey) !== binding.alt) {
    return false;
  }
  if (binding.ctrl !== undefined && Boolean(event.ctrlKey) !== binding.ctrl) {
    return false;
  }
  return true;
};

const discriminatorMatches = (binding: KeyBinding, event: KeyEventLike): boolean => {
  if (binding.code !== undefined) {
    return event.code === binding.code;
  }
  if (binding.key !== undefined) {
    return event.key === binding.key;
  }
  if (binding.keyCode !== undefined) {
    return event.keyCode === binding.keyCode;
  }
  // A binding with no discriminator never matches (guards against typos).
  return false;
};

/**
 * Finds the first {@link KeyBinding} in the keymap that matches `event`.
 * Bindings are evaluated in declaration order, so more specific bindings must
 * be declared before broader ones (e.g. `key: "*"` before `code: "Digit8"`).
 */
export const findBinding = (keymap: Keymap, event: KeyEventLike): KeyBinding | null => {
  for (const binding of keymap.bindings) {
    if (discriminatorMatches(binding, event) && modifierMatches(binding, event)) {
      return binding;
    }
  }
  return null;
};

/** Resolves a {@link KeyEventLike} to a {@link SemanticAction} via the keymap. */
export const resolveSemanticAction = (keymap: Keymap, event: KeyEventLike): SemanticAction | null =>
  findBinding(keymap, event)?.action ?? null;

/** Normalizes a raw key event into a {@link NormalizedKeyEvent}. */
export const normalizeKeyEvent = (event: KeyEventLike, keymap: Keymap): NormalizedKeyEvent => ({
  action: resolveSemanticAction(keymap, event),
  key: event.key,
  code: event.code,
  repeat: Boolean(event.repeat),
  modifiers: {
    alt: Boolean(event.altKey),
    ctrl: Boolean(event.ctrlKey),
    meta: Boolean(event.metaKey),
    shift: Boolean(event.shiftKey),
  },
  raw: event,
});
