/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The Type-tab keyboard adapts to the space it is actually given, not to a
 * device name. Three profiles, deliberately named to match the app's global
 * display-profile vocabulary (`compact | medium | expanded`):
 *
 * - `compact`  — very small portrait displays (Callback 8020-like). A
 *                task-oriented controller: pinned cursor pad + high-value deck,
 *                the rest scrolls. NOT a physical C64 replica.
 * - `medium`   — normal phones. Recognizable C64 ordering with a protected
 *                cursor pad still pinned above a lightly-scrolling grid.
 * - `expanded` — tablets, desktop web, large landscape, spacious portrait.
 *                Renders the physical C64 rows as closely as practical.
 *
 * The profile is resolved from the MEASURED Type-tab content box (width AND
 * height) so that, e.g., a phone in landscape (wide but short) stays `medium`
 * instead of being mis-classified `expanded` purely on width.
 */
export type KeyboardProfile = "compact" | "medium" | "expanded";

export const KEYBOARD_PROFILE_THRESHOLDS = {
  /** At or below this content width the deck-oriented compact layout is used. */
  compactMaxWidth: 340,
  /** The physical-row `expanded` layout needs at least this much width… */
  expandedMinWidth: 700,
  /** …AND at least this much height, so a short wide landscape phone stays `medium`. */
  expandedMinHeight: 460,
} as const;

/**
 * Pure profile resolver. `width`/`height` are the Type-tab content box in CSS
 * pixels. Zero/negative/non-finite dimensions (e.g. before first layout) fall
 * back to `medium`, the safe middle profile that renders every high-value key.
 */
export const resolveKeyboardProfile = (width: number, height: number): KeyboardProfile => {
  const safeWidth = Number.isFinite(width) ? width : 0;
  const safeHeight = Number.isFinite(height) ? height : 0;
  if (safeWidth <= 0) return "medium";
  if (safeWidth <= KEYBOARD_PROFILE_THRESHOLDS.compactMaxWidth) return "compact";
  if (
    safeWidth >= KEYBOARD_PROFILE_THRESHOLDS.expandedMinWidth &&
    safeHeight >= KEYBOARD_PROFILE_THRESHOLDS.expandedMinHeight
  ) {
    return "expanded";
  }
  return "medium";
};
