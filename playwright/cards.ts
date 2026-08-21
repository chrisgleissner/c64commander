/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Locator, Page } from "@playwright/test";

/**
 * Opens every closed card in `scope` (the page by default).
 *
 * Page-level cards render through `CollapsibleSection`, and several are closed on a first visit —
 * a maintenance panel, a secondary drive, a list of other people's documentation. A test that
 * reads or drives something inside one has to open it first. Selecting by testid would tie the
 * test to which cards happen to be closed today, so this uses the disclosure contract itself: a
 * collapsed toggle is a button that says it is not expanded and names the region it controls.
 *
 * Safe to call when everything is already open. Call it after the page has rendered — straight
 * after `goto` there are no toggles yet and it would do nothing.
 */
export const openAllCards = async (scope: Page | Locator): Promise<void> => {
  const toggles = scope.locator('button[aria-expanded="false"][aria-controls]');
  for (let index = 0; index < (await toggles.count()); index++) {
    const toggle = toggles.nth(index);
    // Re-read rather than trusting the snapshot: opening one card can close a sibling on the
    // compact profile, where only one is open at a time.
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
};
