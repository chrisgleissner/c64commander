/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Appearance of a value control that should read as text rather than as a form
 * control - the "Manual" against "Turbo Control", the "8" against "Bus ID". The
 * border, background and chevron are removed for that reason, and that look is
 * deliberate.
 *
 * This constant carries appearance only. It deliberately does NOT set the target
 * size, because the two callers need different layouts and the size must be decided
 * where the row is composed:
 *
 * - `SummaryConfigControlRow` makes the whole row the target, so it appends
 *   `min-h-11 w-full justify-between` AFTER this string. Class order matters: `cn`
 *   merges with tailwind-merge and the later class wins, so the layout classes have to
 *   come second or the `w-auto` here would collapse the row back to the width of its
 *   own text.
 * - The card variants keep their inline sizing.
 *
 * Extracted because the identical string was previously repeated verbatim in three
 * files, so a change to the look had to be made in three places to stay consistent.
 */
export const INLINE_SUMMARY_CONTROL_CLASS =
  "h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden";
