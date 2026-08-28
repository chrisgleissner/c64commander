/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DEVICE_SCHEME_TO_STYLE_ID } from "@/generated/appStyles";

/**
 * The sentinel `resolveAppearance` never sees directly: a persisted "Match my device" choice is
 * stored under this value rather than under whichever style it currently resolves to, so the
 * choice survives a device change (spec.md section 7.4, decision D4).
 */
export const MATCH_MY_DEVICE_SENTINEL = "match-my-device";

/**
 * Maps the Ultimate's own `Color Scheme` setting name to an app style id, per the table compiled
 * from `styles/appearance-styles.yaml`'s `device_scheme_map`. Returns null for an unknown scheme
 * name or when the device has never been probed (disconnected, or not yet connected this
 * session) — the caller falls back to the compiled default and says so, per spec.md section 7.4's
 * "unknown / unreachable" row.
 */
export const resolveMatchMyDeviceStyleId = (deviceColorScheme: string | null): string | null => {
  if (deviceColorScheme === null) return null;
  return DEVICE_SCHEME_TO_STYLE_ID[deviceColorScheme] ?? null;
};
