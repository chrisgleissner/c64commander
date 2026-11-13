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
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";

test.describe("Sleep timer badge beside the Play title", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout and focus only; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    const { viewport, override } = DISPLAY_PROFILE_VIEWPORTS.compact;
    await page.addInitScript((value) => localStorage.setItem("c64u_display_profile_override", value), override);
    await page.setViewportSize(viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("shows minutes left in the app bar on the smallest screen and opens the timer's controls", async ({ page }) => {
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-bar-sleep-timer")).toHaveCount(0);

    const sessionToggle = page.getByTestId("play-section-toggle-playback-settings");
    await sessionToggle.click();
    await expect(sessionToggle).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("sleep-timer-m15").click();

    const badge = page.getByTestId("app-bar-sleep-timer");
    await expect(badge).toBeVisible();
    await expect(page.getByTestId("app-bar-sleep-timer-label")).toHaveText("15m");

    const geometry = await page.evaluate(() => {
      const rect = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      const label = document.querySelector('[data-testid="app-bar-sleep-timer-label"]')!;
      return {
        badge: rect("app-bar-sleep-timer").toJSON() as DOMRect,
        menu: rect("app-bar-quick-menu").toJSON() as DOMRect,
        labelPx: Number.parseFloat(getComputedStyle(label).fontSize),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.badge.width).toBeGreaterThanOrEqual(44);
    expect(geometry.badge.height).toBeGreaterThanOrEqual(44);
    expect(geometry.badge.right).toBeLessThanOrEqual(geometry.menu.left);
    expect(geometry.labelPx).toBeGreaterThanOrEqual(14);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(0);

    await sessionToggle.click();
    await expect(sessionToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("sleep-timer")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await badge.click();
    await expect(page.getByTestId("sleep-timer")).toBeInViewport();
    await expect(page.getByTestId("sleep-timer-m15")).toBeFocused();
  });
});
