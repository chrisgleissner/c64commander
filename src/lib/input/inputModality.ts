/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Imperative input-modality tracking for the keypad/keyboard focus system.
 *
 * Modality answers a single question: did the user most recently act with a
 * recognized navigation/activation KEY, or with a POINTER (touch/mouse)? It
 * gates the only new visible affordance the keypad feature adds — the
 * selected-control highlight (`data-key-selected`) — which appears only while
 * modality is `key-navigation` (and the feature flag is on).
 *
 * This is deliberately a tiny module-level singleton with a value-equality
 * bail and a subscriber set, NOT React state. The selected-control highlight is
 * applied by toggling a DOM attribute on the focused element (mirroring the
 * existing imperative `element.focus()`), so routing modality through React
 * state/effects would risk the project's known setState-in-effect coverage hang.
 * Callers flip it from event handlers and the {@link FocusNavigationProvider}
 * subscribes once to re-apply the highlight. {@link resetInputModality} is for
 * test isolation only.
 */

export type InputModality = "pointer" | "key-navigation";

let currentModality: InputModality = "pointer";
const listeners = new Set<(modality: InputModality) => void>();

/** The current input modality (`pointer` until a recognized key takes effect). */
export const getInputModality = (): InputModality => currentModality;

/**
 * Sets the current modality, notifying subscribers only on a real change. The
 * value-equality bail keeps repeated key presses (or pointer moves) from
 * spamming subscribers / re-applying the highlight every event.
 */
export const setInputModality = (modality: InputModality): void => {
  if (modality === currentModality) return;
  currentModality = modality;
  listeners.forEach((listener) => listener(modality));
};

/** Subscribes to modality changes; returns an unsubscribe function. */
export const subscribeInputModality = (listener: (modality: InputModality) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Resets modality to the default (`pointer`) WITHOUT clearing subscribers, so a
 * mounted provider keeps working. Intended for test setup/teardown isolation.
 */
export const resetInputModality = (): void => {
  currentModality = "pointer";
};
