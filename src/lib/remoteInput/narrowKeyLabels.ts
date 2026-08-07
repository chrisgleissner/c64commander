/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DisplayProfile } from "@/lib/displayProfiles";

/**
 * Shortened key faces for the `compact` display profile — 320 CSS pixels across,
 * the narrowest screen the app supports.
 *
 * Both of these keys share a four-across row with keys whose names are much
 * shorter, so at that width the full name is wider than the key that carries it
 * and spills over its edge. Only the printed face changes: every key keeps its
 * own `aria-label`, so the accessible name stays the full key name on every
 * profile. Nothing outside `compact` is affected.
 */
export const NARROW_DISPLAY_KEY_FACES: Readonly<Record<string, string>> = {
  "RUN/STOP": "RSTOP",
  RESTORE: "RSTR",
};

/**
 * The face to print for `label` on `profile`. Returns `label` unchanged on every
 * profile other than `compact`, and for any key with no shortened face.
 */
export const keyFaceForDisplayProfile = (label: string, profile: DisplayProfile): string =>
  profile === "compact" ? (NARROW_DISPLAY_KEY_FACES[label] ?? label) : label;
