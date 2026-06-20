/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Public API of the keypad / T9 input subsystem.
 *
 * The whole point of this barrel is that UI code imports semantic actions and
 * composer helpers from one place (`@/lib/input`) and never touches raw key
 * codes — physical-key → semantic-action mapping is owned by the keymap and
 * profiles below.
 */

export type { SemanticAction, NormalizedKeyEvent, KeyEventLike, KeyModifiers } from "./keyEvent";
export {
  SEMANTIC_ACTIONS,
  isDigitAction,
  digitForAction,
  normalizeKeyEvent,
  resolveSemanticAction,
  findBinding,
} from "./keyEvent";

export type { Keymap, KeyBinding, T9TimingConfig, KeymapOverride, DefineKeymapInit } from "./keymap";
export { defineKeymap, mergeKeymaps, DEFAULT_MULTITAP_TIMEOUT_MS } from "./keymap";

export type { T9State, T9Mode, T9Pending, T9Config, CursorDirection, CreateT9StateOptions } from "./t9";
export {
  STAR_KEY,
  MULTITAP_CANDIDATES,
  DEFAULT_T9_CONFIG,
  resolveT9Config,
  createT9State,
  pendingCandidateCount,
  pressDigit,
  pressPunctuation,
  commitPending,
  toggleCase,
  pressDelete,
  moveCursor,
  cycleMode,
  setMode,
  setText,
  applySemanticAction,
} from "./t9";

export type { FocusItem } from "./focusController";
export { FocusController } from "./focusController";

export type { InputModality } from "./inputModality";
export { getInputModality, setInputModality, subscribeInputModality, resetInputModality } from "./inputModality";

export type {
  DismissibleLayer,
  NavigationOutcome,
  NavigationCallbacks,
  NavigationControllerOptions,
} from "./focusNavigation";
export { NavigationController } from "./focusNavigation";

export type { InputProfileId } from "./profiles";
export {
  INPUT_PROFILES,
  INPUT_PROFILE_IDS,
  DEFAULT_INPUT_PROFILE_ID,
  resolveInputProfile,
  defaultKeyboardProfile,
  keypadProfile,
} from "./profiles";
