/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { clickSourceSelectionButton } from "./sourceSelection";

/**
 * A phone with the soft keyboard open has about 430 CSS px left for the page. Measured on a Pixel 4
 * with the Add items browser open and a filter being typed: the title, the filter, the scope buttons,
 * the Root/Up/Refresh row and the footer filled the sheet and the file list had no height at all.
 */
test.describe("Add items browser with the soft keyboard open", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout geometry only; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize({ width: 393, height: 430 });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("the filter scrolls with the list, so the list keeps a usable share of the sheet", async ({ page }) => {
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Add items|Add more items/i }).click();
    await clickSourceSelectionButton(page, "C64U");
    await expect(page.getByTestId("c64u-file-picker")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("add-items-filter").focus();
    await page.keyboard.type("a");
    await page.waitForTimeout(400);

    const filterIsInsideTheScrollingList = await page
      .getByTestId("add-items-scroll")
      .getByTestId("add-items-filter")
      .count();
    expect(filterIsInsideTheScrollingList, "the filter stays pinned above the list").toBe(1);

    const share = await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>("[data-testid='add-items-scroll']")!;
      const sheet = document.querySelector<HTMLElement>('[data-app-surface="sheet"]')!;
      return list.clientHeight / sheet.getBoundingClientRect().height;
    });
    expect(share, "share of the filtered browser left to its list").toBeGreaterThanOrEqual(0.4);
  });
});
