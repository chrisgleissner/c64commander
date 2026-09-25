/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";

/** Font sizes, in CSS px, for the text printed on a Type-tab keycap. */
export type KeyCapFontSizes = {
  /** The key's own label, e.g. "Q" or "RETURN". */
  readonly label: number;
  /** A label printed on two lines, e.g. "SHIFT" over "LOCK". */
  readonly stackedLabel: number;
  /** The shifted legend printed beside the label, e.g. "!" above "1". */
  readonly legend: number;
};

/**
 * The deck keyboards (compact and medium) have keys at least 40 px wide, so every legend fits at
 * the 14 px text floor.
 */
const DECK_KEY_CAP_FONT_SIZES: KeyCapFontSizes = { label: 14, stackedLabel: 14, legend: 14 };

/*
 * The expanded replica packs sixteen keys into a row. At its narrowest width a 1u key has about
 * 24 px inside its border, and "HOME" at 14 px needs 43 px, so this profile keeps its smaller type.
 */
const EXPANDED_KEY_CAP_FONT_SIZES: KeyCapFontSizes = { label: 10, stackedLabel: 8, legend: 10 };

/** Returns the same object for a profile every time, so memoised key buttons do not re-render. */
export const resolveKeyCapFontSizes = (profile: KeyboardProfile): KeyCapFontSizes =>
  profile === "expanded" ? EXPANDED_KEY_CAP_FONT_SIZES : DECK_KEY_CAP_FONT_SIZES;
