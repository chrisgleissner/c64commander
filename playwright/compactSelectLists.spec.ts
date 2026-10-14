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

/**
 * A select list opened part-way down the smallest screen has less room on either side of its trigger
 * than its options need. It has to fit that room and scroll, rather than run off the top or bottom of
 * the screen with options that nothing can reach.
 */

const waitForAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );

test.describe("Select lists on the smallest screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
    });
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("a list opened mid-screen stays on screen and every option can be scrolled into view", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");

    const trigger = page.locator('[data-slot-active="true"]').getByTestId("quickconfig-ram-size");
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await trigger.click();

    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await waitForAnimations(page);
    const options = list.getByRole("option");
    expect(await options.count(), "too few options to overflow the room beside the trigger").toBeGreaterThanOrEqual(8);

    // Floating UI places the list at fractional offsets, so it can end a few hundredths of a pixel past an edge it touches.
    const top = -0.5;
    const bottom = page.viewportSize()!.height + 0.5;
    const box = (await list.boundingBox())!;
    expect(box.y, "the list starts above the top of the screen").toBeGreaterThanOrEqual(top);
    expect(box.y + box.height, "the list ends below the bottom of the screen").toBeLessThanOrEqual(bottom);

    for (const option of [options.first(), options.last()]) {
      await option.scrollIntoViewIfNeeded();
      const optionBox = (await option.boundingBox())!;
      expect(optionBox.y).toBeGreaterThanOrEqual(top);
      expect(optionBox.y + optionBox.height).toBeLessThanOrEqual(bottom);
    }
  });
});
