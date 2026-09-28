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
 * A bottom sheet on the smallest supported screen, with the system bars a Pixel 4 reports.
 *
 * Measured on the device at 320 x 427 CSS px with a 30 px status bar and a 48 px navigation bar: the
 * SID Radio sheet stood on the navigation bar at full screen height, so it started 48 px above the
 * top of the screen and its title and Close were drawn under the clock.
 */
test.describe("compact bottom sheets and the system bars", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout geometry only; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize({ width: 320, height: 426 });
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent =
          ":root { --safe-area-inset-top: 30px !important; --safe-area-inset-bottom: 48px !important; }";
        document.head.append(style);
      });
    });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("SID Radio opens between the status bar and the navigation bar, with Close in reach", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const radio = page.getByTestId("home-tile-action.sid-radio");
    await expect(radio).toBeVisible({ timeout: 30_000 });
    await radio.click();

    const sheet = page.getByTestId("sid-radio-launcher-sheet");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(700);

    const box = (await sheet.boundingBox())!;
    expect(box.y, "the sheet starts under the status bar").toBeGreaterThanOrEqual(30 - 0.5);
    expect(box.y + box.height, "the sheet runs under the navigation bar").toBeLessThanOrEqual(426 - 48 + 0.5);

    const close = (await sheet.getByRole("button", { name: "Close" }).last().boundingBox())!;
    expect(close.y, "Close sits under the status bar").toBeGreaterThanOrEqual(30);
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
  });
});
