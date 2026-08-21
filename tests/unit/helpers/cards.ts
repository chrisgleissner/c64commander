/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent } from "@testing-library/react";

/**
 * Opens every closed card in the rendered tree.
 *
 * Page-level cards render through `CollapsibleSection`, and several of them are closed on a first
 * visit — a maintenance panel, a secondary drive, a list of other people's documentation. A test
 * that asserts something about a card's contents has to open it first, and doing that by testid
 * ties the test to which cards happen to be closed today.
 *
 * The selector is the disclosure contract itself: a collapsed toggle is a button that says it is
 * not expanded and names the region it controls.
 */
export const openAllCards = (): void => {
  for (const toggle of document.querySelectorAll<HTMLElement>('button[aria-expanded="false"][aria-controls]')) {
    fireEvent.click(toggle);
  }
};

/**
 * Forgets which cards were open.
 *
 * `CollapsibleSection` remembers that in localStorage, which persists across the tests in one file,
 * so without this one test's open card is restored in the next one — and a test that opens it by
 * clicking then closes it instead.
 */
export const resetCardMemory = (): void => {
  localStorage.clear();
};

/**
 * Opens one card if it is closed, and leaves it alone if it is not.
 *
 * Outside the compact profile a card is open before anyone touches it, so a plain click on its
 * header closes it. A test that wants to read what is inside asks for it to be open, not for it to
 * be toggled.
 */
export const ensureCardOpen = (toggle: HTMLElement): void => {
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
};

/**
 * Closes every open card in the rendered tree — the mirror of {@link openAllCards}, for a test that
 * needs to start from a page nobody has opened anything on.
 */
export const closeAllCards = (): void => {
  for (const toggle of document.querySelectorAll<HTMLElement>('button[aria-expanded="true"][aria-controls]')) {
    fireEvent.click(toggle);
  }
};
