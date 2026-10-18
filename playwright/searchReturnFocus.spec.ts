/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { KEY_SELECTED_ATTRIBUTE as SELECTED, enableKeypad } from "./focusRing";

/**
 * Closing the global search overlay that the Quick menu opened leaves the keypad where the user was.
 * The search field takes DOM focus when the overlay opens and drops it to the body when it closes, so
 * the highlight stayed on the right stop while document.activeElement was the body.
 */

const selectedTestId = (page: Page) =>
  page.evaluate(
    (attribute) => document.querySelector(`[${attribute}="true"]`)?.getAttribute("data-testid") ?? null,
    SELECTED,
  );

const focusedTestId = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null);

type QuickMenuRoute = "menu-key" | "app-bar-button";

const openSearchFromQuickMenu = async (page: Page, route: QuickMenuRoute) => {
  if (route === "menu-key") {
    await page.keyboard.press("ContextMenu");
    await expect(page.getByTestId("keypad-quick-menu")).toBeVisible();
    await page.keyboard.press("7");
  } else {
    for (let step = 0; step < 12 && (await selectedTestId(page)) !== "app-bar-quick-menu"; step += 1) {
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(150);
    }
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("keypad-quick-menu")).toBeVisible();
    for (let step = 0; step < 5 && (await focusedTestId(page)) !== "keypad-quick-menu-search"; step += 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
    }
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("search-overlay")).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeFocused();
};

test.describe("search overlay closed after the Quick menu opened it", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Focus behavior only; no traced journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const path of ["/", "/config"]) {
    for (const route of ["menu-key", "app-bar-button"] as const) {
      test(`returns DOM focus to the highlighted stop on ${path} (${route})`, async ({ page }) => {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForFunction(
          () => document.querySelector('[data-testid="app-shell"]')?.getAttribute("data-launch-phase") === "app-ready",
        );
        await page.waitForTimeout(500);
        for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(300);
        const standingBefore = await selectedTestId(page);
        expect(standingBefore).not.toBeNull();

        await openSearchFromQuickMenu(page, route);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("search-overlay")).toBeHidden();

        const standingAfter = route === "menu-key" ? standingBefore : "app-bar-quick-menu";
        await expect(page.locator(`[${SELECTED}="true"]`)).toHaveAttribute("data-testid", standingAfter!);
        await expect(page.locator(`[data-testid="${standingAfter}"]`)).toBeFocused();
      });
    }
  }
});
