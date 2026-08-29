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
 * It carries the 44px WCAG 2.5.5 target size as well as the look, because every caller
 * needs it: sized to their own text these controls came out as small as 17x17 CSS
 * pixels. Layout is still decided where the row is composed:
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
 *
 * `border-0` is load-bearing and must not be removed as redundant. Every caller puts this on a
 * `SelectTrigger`, whose own base class is `border border-input`; `cn` merges with tailwind-merge,
 * so this string is the only thing turning that edge off. The appearance-token sweep in 0.10.0-rc1
 * deleted it on the reasoning that "a zero-width edge is the same as no edge class", which is true
 * of a bare element and false of one whose base class already draws a border. Every read-only value
 * on Home - Pattern, Color, Tint, SID Select, Turbo Control, the drive and printer selects - then
 * drew a 1px box around its text with no padding inside it, so the text touched the box and the row
 * grew to 49.5px. `inlineControls.spec.ts` measures the rendered border and fails if it returns.
 */
export const INLINE_SUMMARY_CONTROL_CLASS =
  "h-auto min-h-11 w-auto min-w-11 border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden";
