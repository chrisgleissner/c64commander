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
import { TOUR_STEPS } from "../src/lib/tour/steps";

/**
 * The tour on a REAL first launch.
 *
 * seedUiMocks records the tour as already taken, because otherwise its full-screen overlay covers
 * the page every other walk is there to drive. This spec clears that key again, which is the only
 * place the first-launch behaviour is exercised end to end.
 */

const clearTourState = async (page: Page) => {
  await page.addInitScript(() => localStorage.removeItem("c64u_tour_state:v1"));
};

test.describe("first-run tour", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "A first-launch walkthrough; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await clearTourState(page);
    await page.setViewportSize({ width: 393, height: 727 });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("opens on a first launch, walks every step, and never opens again", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tour-progress")).toHaveText(`Step 1 of ${TOUR_STEPS.length}`);

    for (let index = 1; index < TOUR_STEPS.length; index += 1) {
      await page.getByTestId("tour-next").click();
      await expect(page.getByTestId("tour-progress")).toHaveText(`Step ${index + 1} of ${TOUR_STEPS.length}`);
      // Every step either spotlights something or says so; neither is a blank screen.
      await expect(page.getByTestId("tour-caption")).toBeVisible();
    }

    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();

    // A reload must not bring it back: it was completed.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  });

  test("spotlights the Home search field on the step that is about search", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tour-next").click();

    await expect(page.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "search");
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();

    const spotlight = await page.getByTestId("tour-spotlight").boundingBox();
    const field = await page.getByTestId("home-search-field").boundingBox();
    expect(spotlight).not.toBeNull();
    expect(field).not.toBeNull();
    // The hole encloses the field it is pointing at, with its padding.
    expect(spotlight!.y).toBeLessThanOrEqual(field!.y);
    expect(spotlight!.y + spotlight!.height).toBeGreaterThanOrEqual(field!.y + field!.height);
  });

  test("can be skipped at any step, and does not come back", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tour-next").click();
    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  });

  test("is restartable from the card at the top of Docs", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();

    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await page.getByTestId("docs-tour-start").click();
    await expect(page.getByTestId("tour-overlay")).toBeVisible();
    await expect(page.getByTestId("tour-progress")).toHaveText(`Step 1 of ${TOUR_STEPS.length}`);
  });

  test("disables swipe navigation while it runs", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("c64u_enable_swipe_navigation", "1"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "false");

    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();
    await expect(page.getByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "true");
  });
});
