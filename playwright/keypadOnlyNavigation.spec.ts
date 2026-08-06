/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { TAB_ROUTES } from "../src/lib/navigation/tabRoutes";

/**
 * The app driven by keys alone, on the smallest screen it supports.
 *
 * Some hardware the app has to run on leads with a physical keypad and a directional
 * pad, with touch present but secondary or awkward to use. On that hardware a control
 * that can only be reached by tapping cannot be reached at all, and the existing
 * keypad tests do not establish this end to end: they prove the focus ring exists and
 * that specific controls respond, but not that a user who never touches the screen can
 * get from the app opening to every primary page.
 *
 * These tests therefore never call click() or tap(). The only input is key presses.
 *
 * They run at the `tiny` viewport because the two constraints interact: the smaller
 * the screen, the more the ring has to scroll to bring the next control into view, and
 * a control the ring can select but never scroll on screen is not reachable in any way
 * that matters.
 */

const KEYPAD_FLAG_KEY = "c64u_feature_flag:keypad_input_enabled";
const SELECTED = "data-key-selected";

const enableKeypad = (page: Page) =>
  page.addInitScript((key) => {
    localStorage.setItem(key, "true");
  }, KEYPAD_FLAG_KEY);

/**
 * Steps the focus ring until `target` carries the highlight, bounded.
 *
 * Mirrors the walk in keypadInput.spec.ts: ArrowDown moves along the ring at the
 * current level, and Enter goes one level in - into a card that contains the target,
 * or into a closed Settings chapter whose controls are not rendered until it opens.
 */
const ringFocus = async (page: Page, target: Locator, maxSteps = 80): Promise<boolean> => {
  for (let step = 0; step < maxSteps; step += 1) {
    if ((await target.getAttribute(SELECTED)) === "true") return true;

    const handle = await target.elementHandle({ timeout: 250 }).catch(() => null);
    const goIn = await page.evaluate((node) => {
      const selected = document.querySelector('[data-key-selected="true"]');
      if (!selected) return false;
      if (node instanceof Element && selected !== node && selected.contains(node)) return true;
      return selected.matches("[data-section-label]") && selected.getAttribute("data-open") === "false";
    }, handle);
    await handle?.dispose();

    await page.keyboard.press(goIn ? "Enter" : "ArrowDown");
  }
  return (await target.getAttribute(SELECTED)) === "true";
};

/** True when the element is inside the visible viewport, not merely in the DOM. */
const isOnScreen = (target: Locator) =>
  target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  });

const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  await page.waitForTimeout(500);
};

test.describe("Keypad-only navigation on the smallest screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Navigation-only coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
    });
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.tiny.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("every primary page is reachable using only the keypad @layout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);

    // The first key press is what arms the ring; before it there is no highlight at
    // all, which is the documented "Prime Directive" behaviour.
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    for (const route of TAB_ROUTES) {
      const tabId = `tab-${route.label.toLowerCase()}`;
      const tab = page.getByTestId(tabId);

      const reached = await ringFocus(page, tab);
      expect(reached, `The focus ring could not reach the ${route.label} tab using key presses alone`).toBe(true);

      expect(
        await isOnScreen(tab),
        `The ${route.label} tab carries the focus ring but is not on screen, so a keypad user cannot see where they are`,
      ).toBe(true);

      await page.keyboard.press("Enter");
      await expect
        .poll(() => page.evaluate(() => window.location.pathname), {
          message: `Enter on the ${route.label} tab did not navigate`,
          timeout: 15_000,
        })
        .toBe(route.path);
      await page.waitForTimeout(400);
    }
  });

  test("the focus ring keeps its target on screen while walking a page @layout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await settle(page);

    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    // Walk a long page and check the ring never selects something it has not also
    // scrolled into view. On a 426px-tall viewport this is the difference between a
    // usable page and one where the selection disappears under the tab bar.
    const offScreen: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      const info = await page.evaluate(() => {
        const selected = document.querySelector('[data-key-selected="true"]');
        if (!selected) return null;
        const rect = selected.getBoundingClientRect();
        const label = (selected.getAttribute("data-testid") ?? selected.textContent ?? "").trim().slice(0, 40);
        return {
          label,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewportHeight: window.innerHeight,
        };
      });

      if (info && info.height > 0) {
        // Fully above the fold or fully below it means the user cannot see the ring.
        if (info.bottom <= 0 || info.top >= info.viewportHeight) {
          offScreen.push(`${info.label} (top ${Math.round(info.top)}, bottom ${Math.round(info.bottom)})`);
        }
      }

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
    }

    expect(offScreen, `The focus ring selected controls that were off screen:\n  ${offScreen.join("\n  ")}`).toEqual(
      [],
    );
  });
});
