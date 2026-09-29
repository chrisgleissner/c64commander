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

/**
 * In landscape Android draws its navigation bar down one side of the screen rather than along the
 * bottom. Measured on a Pixel 4 at the smallest supported geometry turned sideways (427 x 320 CSS px),
 * the bar was 48 CSS px wide and covered the Docs tab, because the tab bar spans the full width and
 * reserved only the bottom inset.
 */
test.describe("a navigation bar down the side in landscape", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout geometry only; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize({ width: 427, height: 320 });
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const side of ["right", "left"] as const) {
    test(`keeps every tab clear of a bar on the ${side}`, async ({ page }) => {
      const inset = 48;
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.evaluate(({ name, value }) => document.documentElement.style.setProperty(name, `${value}px`), {
        name: `--safe-area-inset-${side}`,
        value: inset,
      });
      await page.waitForTimeout(200);

      const tabs = page.locator("nav.tab-bar [data-testid^='tab-']");
      const count = await tabs.count();
      expect(count).toBeGreaterThanOrEqual(6);
      for (let index = 0; index < count; index += 1) {
        const tab = tabs.nth(index);
        await tab.scrollIntoViewIfNeeded();
        const box = await tab.boundingBox();
        const testId = await tab.getAttribute("data-testid");
        expect(box, `${testId} must be laid out`).not.toBeNull();
        if (side === "right") {
          expect(box!.x + box!.width, `${testId} must sit left of the bar`).toBeLessThanOrEqual(427 - inset);
        } else {
          expect(box!.x, `${testId} must sit right of the bar`).toBeGreaterThanOrEqual(inset);
        }
      }
    });
  }
});
