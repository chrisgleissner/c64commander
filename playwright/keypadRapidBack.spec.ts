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

const RAPID_BACK_GAP_MS = 50;

const pressSoftLeft = (page: Page) =>
  page.evaluate(() => {
    const target = document.activeElement ?? document;
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Unidentified", code: "SoftLeft" }),
    );
  });

test.describe("Rapid Back (left soft key) presses on the keypad", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Keypad Back coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.addInitScript(() => localStorage.setItem("c64u_feature_flag:new_disk_enabled", "1"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("two Back presses 50 ms apart close an open select and then its dialog", async ({ page }) => {
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await page.locator('[data-slot-active="true"]').getByTestId("new-disk-open").click();
    const dialog = page.getByRole("dialog", { name: "New disk" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByTestId("new-disk-type").click();
    await expect(page.getByRole("listbox")).toBeVisible();

    await pressSoftLeft(page);
    await page.waitForTimeout(RAPID_BACK_GAP_MS);
    await pressSoftLeft(page);

    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
  });
});
