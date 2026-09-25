/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Keymap } from "@/lib/input/keymap";
import { normalizeKeyEvent, type SemanticAction } from "@/lib/input/keyEvent";
import {
  applySemanticAction,
  commitPending,
  createT9State,
  DEFAULT_T9_CONFIG,
  setText,
  type T9Mode,
  type T9State,
} from "@/lib/input/t9";

/**
 * T9 for every text field, not only the ones that wire a composer of their own.
 *
 * On a phone driven only by its number pad, a field that takes the digits literally cannot hold a
 * name, a search or a password. Fields that compose for themselves call `preventDefault`, and this
 * runs after them, so it only picks up what they left.
 */

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "password", "url", "email"]);

const COMPOSER_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>([
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
  "toggleInputMode",
]);

/** The right soft key deletes in a field with text: a keypad has no Backspace, and Back leaves the field. */
export const T9_DELETE_ACTION: SemanticAction = "softRight";

export type T9Field = HTMLInputElement | HTMLTextAreaElement;

export const isT9Field = (target: EventTarget | null): target is T9Field => {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (!(target instanceof HTMLInputElement)) return false;
  if (target.readOnly || target.disabled) return false;
  if (!TEXT_INPUT_TYPES.has(target.type)) return false;
  if (target.inputMode === "numeric" || target.inputMode === "decimal" || target.inputMode === "tel") return false;
  return target.dataset.t9 !== "off";
};

type FieldComposer = { state: T9State; emitted: string };

const composers = new WeakMap<T9Field, FieldComposer>();

const composerFor = (field: T9Field): FieldComposer => {
  let composer = composers.get(field);
  if (!composer) {
    const mode: T9Mode = field.dataset.t9Mode === "hostname" ? "hostname" : "multitap";
    composer = { state: createT9State({ text: field.value, mode }), emitted: field.value };
    composers.set(field, composer);
  } else if (field.value !== composer.emitted) {
    // A field that only re-cases what was typed (a hex address upper-cases it) keeps the letter
    // being cycled; resetting the composer would drop it. The field's casing still wins.
    composer.state =
      field.value.toLowerCase() === composer.emitted.toLowerCase()
        ? { ...composer.state, text: field.value }
        : setText(composer.state, field.value);
    composer.emitted = field.value;
  }
  return composer;
};

/** Leaving a field ends the letter being cycled, so the next press there starts a new one. */
export const endT9Composition = (target: EventTarget | null): void => {
  if (!isT9Field(target)) return;
  const composer = composers.get(target);
  if (composer) composer.state = commitPending(composer.state);
};

/** Writes through the native setter and fires `input`, so a React-controlled field sees an ordinary edit. */
const writeValue = (field: T9Field, next: string) => {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

/**
 * Composes one key into the focused field. Returns whether the key was consumed; the caller then
 * prevents the browser from also inserting the digit.
 */
export const composeT9Key = (event: KeyboardEvent, keymap: Keymap, now: number): boolean => {
  if (event.defaultPrevented || !isT9Field(event.target)) return false;
  const field = event.target;
  const { action } = normalizeKeyEvent(event, keymap);
  if (action === null) return false;
  const deleting = action === T9_DELETE_ACTION;
  if (!deleting && !COMPOSER_ACTIONS.has(action)) return false;
  if (deleting && field.value.length === 0) return false;

  const composer = composerFor(field);
  composer.state = applySemanticAction(composer.state, deleting ? "delete" : action, now, DEFAULT_T9_CONFIG);
  if (composer.state.text !== composer.emitted) {
    composer.emitted = composer.state.text;
    writeValue(field, composer.state.text);
  }
  return true;
};
