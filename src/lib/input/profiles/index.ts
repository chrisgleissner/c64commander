/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Input profile registry. A profile is just a {@link Keymap}; auto-detection
 * is unreliable in some Android WebView hosts, so a settings/developer override
 * can pick a profile explicitly via {@link resolveInputProfile}.
 */

import type { Keymap } from "../keymap";
import { applyKeymapOverrides, getKeymapOverridesVersion } from "../keymapOverrides";
import { defaultKeyboardProfile } from "./defaultKeyboard";
import { keypadProfile } from "./keypad";

export const INPUT_PROFILES = {
  defaultKeyboard: defaultKeyboardProfile,
  keypad: keypadProfile,
} as const satisfies Record<string, Keymap>;

export type InputProfileId = keyof typeof INPUT_PROFILES;

export const DEFAULT_INPUT_PROFILE_ID: InputProfileId = "defaultKeyboard";

export const INPUT_PROFILE_IDS: readonly InputProfileId[] = Object.keys(INPUT_PROFILES) as InputProfileId[];

const isInputProfileId = (value: string): value is InputProfileId =>
  Object.prototype.hasOwnProperty.call(INPUT_PROFILES, value);

const resolvedProfiles = new Map<InputProfileId, Keymap>();
let resolvedAtVersion = -1;

/**
 * Resolves a profile id (possibly unknown/undefined) to a keymap, with any installed keymap
 * override files applied. Resolve at the time of use rather than at module load: override files
 * are read after startup, so a keymap captured at import time would never see them.
 */
export const resolveInputProfile = (id?: string | null): Keymap => {
  const profileId = id && isInputProfileId(id) ? id : DEFAULT_INPUT_PROFILE_ID;
  if (resolvedAtVersion !== getKeymapOverridesVersion()) {
    resolvedProfiles.clear();
    resolvedAtVersion = getKeymapOverridesVersion();
  }
  let keymap = resolvedProfiles.get(profileId);
  if (!keymap) {
    keymap = applyKeymapOverrides(INPUT_PROFILES[profileId], profileId);
    resolvedProfiles.set(profileId, keymap);
  }
  return keymap;
};

export { defaultKeyboardProfile, keypadProfile };
