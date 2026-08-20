/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Locator, Page } from "@playwright/test";

/**
 * Driving the keypad focus ring from a test.
 *
 * Shared because two specs walk the ring for different reasons - keypadInput.spec.ts
 * proves the ring exists and that controls respond to it, keypadOnlyNavigation.spec.ts
 * proves a user who never touches the screen can reach every page - and a second copy of
 * the walk would be free to drift from the first while both kept passing.
 */

/** The ring marks its position with this attribute rather than by moving DOM focus. */
export const KEY_SELECTED_ATTRIBUTE = "data-key-selected";

/** The feature flag that arms the ring. The stored value is "1", not "true". */
export const KEYPAD_FLAG_KEY = "c64u_feature_flag:keypad_input_enabled";

export const enableKeypad = (page: Page) =>
  page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        // A test that has not navigated yet has an opaque origin; anything else is real.
        if (location.origin !== "null") throw error;
      }
    },
    { key: KEYPAD_FLAG_KEY, value: "1" },
  );

/**
 * Steps the focus ring until `target` carries the highlight, bounded.
 *
 * ArrowDown walks the ring at its current level; a control inside a card or a Settings
 * chapter is one level in. So this presses OK - "OK goes in" - whenever the ring is
 * sitting on a container that holds the target, and whenever it is sitting on a closed
 * Settings chapter, whose controls are not rendered at all until it is opened.
 * Otherwise it steps to the next item. That is exactly the sequence a keypad user
 * performs.
 */
export const ringFocus = async (page: Page, target: Locator, maxSteps = 80): Promise<boolean> => {
  for (let step = 0; step < maxSteps; step += 1) {
    if ((await target.getAttribute(KEY_SELECTED_ATTRIBUTE)) === "true") return true;

    const handle = await target.elementHandle({ timeout: 250 }).catch(() => null);
    const goIn = await page.evaluate((node) => {
      const selected = document.querySelector('[data-key-selected="true"]');
      if (!selected) return false;
      // Descend when the target is inside whatever is selected.
      if (node instanceof Element && selected !== node && selected.contains(node)) return true;
      // Otherwise open a closed card ONLY when the target is not in the document at all, which is
      // the case where it must be behind one. Opening every closed card on the way past used to be
      // harmless because cards stayed open; the compact profile now keeps one open at a time, so a
      // card opened earlier in the walk is closed again by the next one and the walk can spend its
      // whole step budget reopening cards instead of advancing to a target that is already visible.
      if (node instanceof Element) return false;
      return selected.matches("[data-section-label]") && selected.getAttribute("data-open") === "false";
    }, handle);
    await handle?.dispose();

    await page.keyboard.press(goIn ? "Enter" : "ArrowDown");
  }
  return (await target.getAttribute(KEY_SELECTED_ATTRIBUTE)) === "true";
};
