/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { findBinding, type SemanticAction } from "@/lib/input/keyEvent";
import type { Keymap } from "@/lib/input/keymap";

/**
 * What a key on this device actually emits (spec.md section 9.4).
 *
 * The Commodore key cannot be bound without knowing its code, and the existing key diagnostics
 * cannot answer that question: they emit only when debug logging is on, events on editable targets
 * are deliberately never logged, and an event inside an open overlay returns before diagnostics are
 * emitted — which is exactly where this panel lives. So it installs its own listener and records
 * KEY IDENTITY ONLY: never the character a key produced, and never any field's contents.
 */

export interface KeyObservation {
  readonly at: number;
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  /** The semantic action the active profile resolves it to, or null when it resolves to nothing. */
  readonly action: SemanticAction | null;
}

/** The last ten, newest first. */
export const KEY_OBSERVATION_LIMIT = 10;

/**
 * A printable character IS content: recording it would put what someone typed into a report they
 * are about to attach to a bug. `key` is replaced by a shape, not the character.
 */
export const redactKey = (key: string): string => {
  if (key.length !== 1) return key;
  if (/[0-9]/.test(key)) return "<digit>";
  if (/\s/.test(key)) return "<space>";
  return "<character>";
};

export const observeKey = (event: KeyboardEvent, keymap: Keymap): KeyObservation => ({
  at: Date.now(),
  key: redactKey(event.key),
  code: event.code,
  keyCode: event.keyCode,
  shift: event.shiftKey,
  alt: event.altKey,
  ctrl: event.ctrlKey,
  action: findBinding(keymap, event)?.action ?? null,
});

export const foldObservation = (
  existing: readonly KeyObservation[],
  observation: KeyObservation,
  limit = KEY_OBSERVATION_LIMIT,
): KeyObservation[] => [observation, ...existing].slice(0, limit);

/** The report text the Copy button puts on the clipboard, for pasting into a bug. */
export const formatObservations = (observations: readonly KeyObservation[]): string => {
  if (observations.length === 0) return "No keys recorded.";
  const rows = observations.map((observation) => {
    const modifiers = [observation.shift && "shift", observation.alt && "alt", observation.ctrl && "ctrl"]
      .filter(Boolean)
      .join("+");
    return [
      `key=${observation.key}`,
      `code=${observation.code === "" ? "<empty>" : observation.code}`,
      `keyCode=${observation.keyCode}`,
      modifiers === "" ? null : `modifiers=${modifiers}`,
      `action=${observation.action ?? "<unbound>"}`,
    ]
      .filter(Boolean)
      .join(" ");
  });
  return ["Key Explorer — newest first", ...rows].join("\n");
};
