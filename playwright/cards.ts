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
  // Element handles, not `nth(i)` on a live locator. Clicking one card changes which toggles still
  // match `aria-expanded="false"`, so an index taken before the click points somewhere else — or
  // at nothing, and the call then waits out its timeout.
  const toggles = await scope.locator('button[aria-expanded="false"][aria-controls]').elementHandles();
  for (const toggle of toggles) {
    // Re-read each one: on the compact profile opening a card closes its siblings, so a toggle
    // captured as closed may have been opened and closed again by the time its turn comes.
    if ((await toggle.getAttribute("aria-expanded")) !== "false") continue;
    // Opening a card scrolls it into view, which moves the ones below it — including under the
    // fixed header, where a click would wait out its timeout.
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
  }
};
