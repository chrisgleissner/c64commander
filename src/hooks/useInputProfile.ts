/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo, useSyncExternalStore } from "react";

import type { Keymap } from "@/lib/input/keymap";
import { getKeymapOverridesVersion, subscribeKeymapOverrides } from "@/lib/input/keymapOverrides";
import { resolveInputProfile } from "@/lib/input/profiles";

/** The resolved keymap for a profile, re-resolved whenever keymap override files are (re)installed. */
export const useInputProfile = (profileId?: string | null): Keymap => {
  const overridesVersion = useSyncExternalStore(
    subscribeKeymapOverrides,
    getKeymapOverridesVersion,
    getKeymapOverridesVersion,
  );
  return useMemo(() => resolveInputProfile(profileId), [profileId, overridesVersion]);
};
