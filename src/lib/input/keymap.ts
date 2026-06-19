/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Keymap registry — the data-driven, colocated mapping from physical keys to
 * {@link SemanticAction}s. This is intentionally declarative: profiles
 * (`./profiles`) build keymaps from these primitives, and key normalization
 * (`./keyEvent`) consumes them. No UI component should ever read a raw key code.
 */

import type { SemanticAction } from "./keyEvent";

/**
 * A single physical-key → semantic-action rule.
 *
 * Exactly one discriminator should be set, evaluated in priority order:
 *   1. `code`    — `KeyboardEvent.code` (layout-independent, preferred)
 *   2. `key`     — `KeyboardEvent.key`  (fallback, e.g. for `*` / `#`)
 *   3. `keyCode` — legacy numeric code  (last resort for old WebViews)
 *
 * Modifier fields (`shift`/`alt`/`ctrl`), when set, must match the event's
 * modifier state. When unset, the modifier is ignored.
 */
export interface KeyBinding {
  readonly code?: string;
  readonly key?: string;
  readonly keyCode?: number;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: SemanticAction;
}

export interface T9TimingConfig {
  /** Window within which a repeated same-key press cycles candidates. */
  readonly multiTapTimeoutMs: number;
}

export interface Keymap {
  readonly id: string;
  /** Bindings evaluated in order; first match wins. */
  readonly bindings: readonly KeyBinding[];
  readonly timing: T9TimingConfig;
}

/** Default multi-tap window. Phone keypads feel best around ~0.8–1.0s. */
export const DEFAULT_MULTITAP_TIMEOUT_MS = 800;

export interface DefineKeymapInit {
  readonly id: string;
  readonly bindings: readonly KeyBinding[];
  readonly timing?: Partial<T9TimingConfig>;
}

/** Builds a {@link Keymap}, filling in default timing. */
export const defineKeymap = (init: DefineKeymapInit): Keymap => ({
  id: init.id,
  bindings: init.bindings,
  timing: {
    multiTapTimeoutMs: init.timing?.multiTapTimeoutMs ?? DEFAULT_MULTITAP_TIMEOUT_MS,
  },
});

export interface KeymapOverride {
  readonly id?: string;
  readonly bindings?: readonly KeyBinding[];
  readonly timing?: Partial<T9TimingConfig>;
}

/**
 * Composes a keymap from a base plus an override. Override bindings are given
 * higher priority (prepended), so a profile can shadow base bindings without
 * mutating them. This is how device profiles extend the desktop profile.
 */
export const mergeKeymaps = (base: Keymap, override: KeymapOverride): Keymap => ({
  id: override.id ?? base.id,
  bindings: [...(override.bindings ?? []), ...base.bindings],
  timing: {
    multiTapTimeoutMs: override.timing?.multiTapTimeoutMs ?? base.timing.multiTapTimeoutMs,
  },
});
