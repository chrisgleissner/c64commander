/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type TabBarFitInput = {
  /** The natural width of each tab's label, whether or not it is currently shown. */
  readonly labelWidths: readonly number[];
  /** The least width a tab may have (the touch target floor). */
  readonly minTabWidth: number;
  /** The horizontal padding inside each tab. */
  readonly tabPadding: number;
  /** The width the bar has for its tabs, after its own padding. */
  readonly availableWidth: number;
};

/**
 * Whether the tabs cannot all show their label in the bar.
 *
 * The labels' own widths decide it, not the current layout, so showing icons alone does not change the
 * answer and the bar cannot flip back and forth.
 */
export const tabLabelsOverflow = ({
  labelWidths,
  minTabWidth,
  tabPadding,
  availableWidth,
}: TabBarFitInput): boolean => {
  const needed = labelWidths.reduce((sum, width) => sum + Math.max(minTabWidth, width + tabPadding), 0);
  return needed > availableWidth;
};
