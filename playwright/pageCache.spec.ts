/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

/**
 * A visited tab page stays built while another tab is shown, and is shown again exactly as it was left: the scroll
 * offset, which cards are open, and what was typed. Test probes rebuild pages by default so a test id names one
 * element; this spec opts back in to the page cache the app ships with.
 */

const activeSlot = (page: Page) => page.locator('[data-slot-active="true"]');

const openTab = async (page: Page, label: string) => {
  await page.getByTestId(`tab-${label}`).click();
  await expect(page.locator(`#page-${label}`)).toBeVisible();
  await expect(page.getByTestId("swipe-navigation-runway")).toHaveAttribute("data-runway-phase", "idle");
};

test.describe("page cache", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      (window as Window & { __c64uCacheVisitedPages?: boolean }).__c64uCacheVisitedPages = true;
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("keeps a keypad-focused control clear of the header height its own page holds", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("#page-settings")).toBeVisible();
    const margin = await activeSlot(page).evaluate((slot) => {
      (slot as HTMLElement).style.setProperty("--app-bar-height", "123px");
      const control = document.createElement("button");
      control.className = "keypad-scroll-anchor";
      slot.appendChild(control);
      const value = getComputedStyle(control).scrollMarginTop;
      control.remove();
      const inset = Number.parseFloat(getComputedStyle(slot).getPropertyValue("--safe-area-inset-top")) || 0;
      const halfRem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 2;
      return { value, expected: `${inset + 123 + halfRem}px` };
    });
    expect(margin.value).toBe(margin.expected);
  });

  test("shows a page again at its scroll offset, with its cards and typed text as they were left", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("#page-settings")).toBeVisible();

    const settings = activeSlot(page);
    const about = settings.getByTestId("settings-section-about");
    if ((await about.getAttribute("data-open")) !== "false") {
      await settings.getByTestId("settings-section-toggle-about").click();
    }
    await expect(about).toHaveAttribute("data-open", "false");
    const host = settings.getByTestId("settings-device-host");
    await host.fill("typed-but-not-saved");

    const scroller = settings.locator("[data-page-scroll-container]");
    await scroller.evaluate((element) => {
      element.scrollTop = Math.min(400, element.scrollHeight - element.clientHeight);
    });
    const leftAt = await scroller.evaluate((element) => element.scrollTop);
    expect(leftAt).toBeGreaterThan(0);

    await openTab(page, "play");
    await expect(page.getByTestId("swipe-slot-settings")).toHaveAttribute("data-slot-cached", "true");
    await expect(page.getByTestId("swipe-slot-settings").getByTestId("settings-device-host")).toBeHidden();

    await openTab(page, "settings");
    const shown = activeSlot(page);
    await expect(shown.getByTestId("settings-device-host")).toHaveValue("typed-but-not-saved");
    await expect(shown.getByTestId("settings-section-about")).toHaveAttribute("data-open", "false");
    expect(await shown.locator("[data-page-scroll-container]").evaluate((element) => element.scrollTop)).toBe(leftAt);
  });

  test("never lets a hidden page take a tap meant for the page on screen", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("#page-settings")).toBeVisible();
    await openTab(page, "docs");

    const docs = activeSlot(page);
    const target = docs.getByRole("button").first();
    await expect(target).toBeVisible();
    const box = (await target.boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-route-index]")?.getAttribute("data-route-index"),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hit).toBe("5");
  });
});
