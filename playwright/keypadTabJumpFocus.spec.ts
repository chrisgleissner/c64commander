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
import { enableKeypad } from "./focusRing";

const selectedLocation = (page: Page) =>
  page.evaluate(() => {
    const selected = document.querySelector('[data-key-selected="true"]');
    if (!selected) return "none";
    const where = selected.closest("[data-focus-scope='tabbar']") ? "tab bar" : "page";
    return `${where}:${selected.getAttribute("data-testid") ?? selected.getAttribute("aria-label")}`;
  });

test.describe("Tab jump by number key", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Keypad focus coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const [key, path] of [
    ["3", "/"],
    ["3", "/play"],
    ["2", "/disks"],
  ] as const) {
    test(`the ${key} key from ${path} followed at once by Down keeps the ring on the page, not the tab bar`, async ({
      page,
    }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
      await page.keyboard.press("ArrowDown");

      await expect.poll(() => selectedLocation(page), { timeout: 10_000 }).toMatch(/^page:(?!page-loading)/);
      await page.waitForTimeout(500);
      expect(await selectedLocation(page)).not.toMatch(/^tab bar/);
    });
  }
});
