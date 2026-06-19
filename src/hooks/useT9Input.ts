/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * React adapter that lets ANY controlled text input accept physical T9 / keypad
 * input as a fallback when the on-screen keyboard is impractical (e.g. a
 * keypad-first device). It is a thin bridge over the pure
 * composer in `@/lib/input`: it does not own the value, it composes onto the
 * value the parent already controls.
 *
 * Design (deliberately append-oriented for robust no-soft-keyboard entry):
 *   - digit keys, the star key, and the mode key (#) are routed through the T9
 *     composer; the browser's default insertion is suppressed for those.
 *   - Every OTHER key passes through untouched: Backspace/Delete and the arrow
 *     keys keep their native behaviour (they operate on the real DOM caret,
 *     which the composer does not track), and Tab/Enter/Escape/letters keep
 *     focus navigation, form submit, and direct typing working. This keeps T9 a
 *     non-intrusive fallback. The lower-level composer in `@/lib/input` still
 *     implements delete and cursor moves for keypad-only contexts.
 *
 * The composer is timestamp-driven, so multi-tap cycling vs. new-character is
 * decided by the real time between presses — no timers are needed.
 */

import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  applySemanticAction,
  createT9State,
  normalizeKeyEvent,
  resolveInputProfile,
  resolveT9Config,
  setText,
  type SemanticAction,
  type T9Config,
  type T9Mode,
  type T9State,
} from "@/lib/input";

/**
 * Semantic actions a focused text field routes into the composer. Backspace,
 * arrows, Enter and Tab are intentionally excluded so they keep their native
 * DOM behaviour (the adapter is append-oriented and does not track the caret).
 */
const FIELD_COMPOSER_ACTIONS: ReadonlySet<SemanticAction> = new Set<SemanticAction>([
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

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

export interface UseT9InputOptions {
  /** Current field value (the parent remains the source of truth). */
  readonly value: string;
  /** Called with the newly composed value. */
  readonly setValue: (next: string) => void;
  /** Initial composition mode. Connection (host/IP) fields use "hostname". */
  readonly mode?: T9Mode;
  /** Input profile id (e.g. "keypad"); falls back to default. */
  readonly profileId?: string | null;
  readonly config?: Partial<T9Config>;
  /** When false the adapter is inert and all keys pass through. */
  readonly enabled?: boolean;
  /** Clock injection for deterministic tests. */
  readonly now?: () => number;
}

export interface UseT9Input {
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** The composer's current mode, for an optional on-screen indicator. */
  readonly mode: T9Mode;
}

export const useT9Input = ({
  value,
  setValue,
  mode: initialMode = "multitap",
  profileId,
  config,
  enabled = true,
  now = defaultNow,
}: UseT9InputOptions): UseT9Input => {
  const resolvedConfig = useMemo(() => resolveT9Config(config), [config]);
  const keymap = useMemo(() => resolveInputProfile(profileId), [profileId]);
  const stateRef = useRef<T9State>(createT9State({ text: value, mode: initialMode }));
  const lastEmittedRef = useRef<string>(value);
  const [mode, setModeState] = useState<T9Mode>(initialMode);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!enabled) return;
      const { action } = normalizeKeyEvent(event, keymap);
      if (action === null || !FIELD_COMPOSER_ACTIONS.has(action)) {
        // Not a composer key — let focus nav / form submit / native typing run.
        return;
      }

      // Reconcile with an external change (parent sanitized the value, or the
      // user typed via the soft keyboard) before composing the next character.
      if (value !== stateRef.current.text && value !== lastEmittedRef.current) {
        stateRef.current = setText(stateRef.current, value);
      }

      event.preventDefault();
      const next = applySemanticAction(stateRef.current, action, now(), resolvedConfig);
      stateRef.current = next;
      if (next.mode !== mode) {
        setModeState(next.mode);
      }
      if (next.text !== lastEmittedRef.current) {
        lastEmittedRef.current = next.text;
        setValue(next.text);
      }
    },
    [enabled, keymap, mode, now, resolvedConfig, setValue, value],
  );

  return { onKeyDown, mode };
};
