/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { JoystickInputName } from "@/lib/c64api";
import type { SemanticAction } from "@/lib/input";

/**
 * Both physical input methods (T9 numeric keypad, hardware D-pad + select)
 * already normalize to the app's existing {@link SemanticAction} layer
 * (`resolveSemanticAction`) rather than raw keycodes — see
 * `docs/keyboard-input.md`. These tables translate that shared domain into
 * joystick held-inputs for Joystick output mode; Type output mode instead
 * feeds the same semantic actions through the T9 composer / cursor mapping.
 *
 * Numeric-keypad convention (matches classic phone-keypad snake games):
 * `2/4/6/8` → up/left/right/down, `1/3/7/9` → diagonals, `5`/`0` → fire.
 */
const T9_JOYSTICK_MAP: Partial<Record<SemanticAction, JoystickInputName[]>> = {
  digit2: ["up"],
  digit8: ["down"],
  digit4: ["left"],
  digit6: ["right"],
  digit1: ["up", "left"],
  digit3: ["up", "right"],
  digit7: ["down", "left"],
  digit9: ["down", "right"],
  digit5: ["fire"],
  digit0: ["fire"],
};

export const t9KeyToJoystickInputs = (action: SemanticAction): JoystickInputName[] => T9_JOYSTICK_MAP[action] ?? [];

/** Hardware D-pad directions map straight to joystick directions; center/select = fire. */
const DPAD_JOYSTICK_MAP: Partial<Record<SemanticAction, JoystickInputName[]>> = {
  dpadUp: ["up"],
  dpadDown: ["down"],
  dpadLeft: ["left"],
  dpadRight: ["right"],
  center: ["fire"],
};

export const dpadActionToJoystickInputs = (action: SemanticAction): JoystickInputName[] =>
  DPAD_JOYSTICK_MAP[action] ?? [];
