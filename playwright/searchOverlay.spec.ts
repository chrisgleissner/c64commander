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
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";
import { disableTraceAssertions } from "./traceUtils";

/**
 * Search as a user meets it: the three doors, and the layout floor of spec.md section 12.
 *
 * The smallest supported screen at the largest text size is 320 x 427 CSS px. Nothing on Home or in
 * the overlay may truncate to nothing there, and every row must still meet the 44 px target floor.
 */

const SMALLEST_VIEWPORT = { width: 320, height: 427 };

const settle = async (page: Page) => {
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => document.readyState === "complete");
};

test.describe("search overlay", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Structural and layout assertions rather than a traced journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test.describe("the three doors", () => {
    test("the Home field opens it", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("home-search-field").click();
      await expect(page.getByTestId("search-overlay")).toBeVisible();
      await expect(page.getByTestId("search-input")).toBeFocused();
    });

    test("the 7 key opens it", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.locator("body").click({ position: { x: 5, y: 200 } });
      await page.keyboard.press("Digit7");
      await expect(page.getByTestId("search-overlay")).toBeVisible();
    });

    /*
     * Opening from the Quick menu closes that dialog FIRST. Stacking two Radix focus scopes and
     * letting one unmount under the other is a known source of stray focus and swallowed Back
     * presses in this codebase (spec.md section 5.7).
     */
    test("the Quick menu opens it, with only one dialog on screen at the end", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("app-bar-quick-menu").first().click();
      await expect(page.getByTestId("keypad-quick-menu")).toBeVisible();

      await page.getByTestId("keypad-quick-menu-search").click();
      await expect(page.getByTestId("search-overlay")).toBeVisible();
      await expect(page.getByTestId("keypad-quick-menu")).toHaveCount(0);
    });
  });

  test.describe("finding things", () => {
    test("reaches a Settings row by name and lands on it", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("home-search-field").click();
      await page.getByTestId("search-input").fill("text size");
      await page.getByTestId("search-result-settings.control.text-size").click();

      await expect(page.getByTestId("search-overlay")).toBeHidden();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByTestId("settings-text-size")).toBeVisible();
    });

    test("keeps the field's focus when Down moves through the results", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("home-search-field").click();
      const input = page.getByTestId("search-input");
      await input.fill("settings");
      await expect(page.locator('[role="option"]').first()).toBeVisible();

      const first = await input.getAttribute("aria-activedescendant");
      await input.press("ArrowDown");
      await expect(input).toBeFocused();
      expect(await input.getAttribute("aria-activedescendant")).not.toBe(first);
    });

    test("lists a result it cannot run, with its reason", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("home-search-field").click();
      await page.getByTestId("search-input").fill("game mode");

      const row = page.getByTestId("search-result-action.game-mode");
      await expect(row).toBeVisible();
      // Whether it is enabled depends on the mock device; either way it must never be hidden.
      const disabled = await row.getAttribute("aria-disabled");
      if (disabled === "true") expect((await row.textContent()) ?? "").not.toBe("Game Mode");
    });
  });

  test.describe("at 320 x 427, the largest text size", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((scaleId: string) => {
        localStorage.setItem("c64u_text_scale", scaleId);
        localStorage.setItem("c64u_display_profile_override", "compact");
      }, LARGEST_TEXT_SCALE_ID);
      await page.setViewportSize(SMALLEST_VIEWPORT);
    });

    /*
     * Every tile label is drawn WHOLE, not clipped.
     *
     * The first version of these tiles put the icon beside the label in a flex row. On the device
     * at the largest Text size that left about 50 CSS px for the text in a 131 px track and all
     * four labels were clipped — "Live View" among them. QuickActionCard puts the icon above the
     * label, so the label has the whole track and is free to wrap.
     */
    test("draws every tile label whole rather than clipping it", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);

      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="home-tile-"]')].flatMap((tile) =>
          [...tile.querySelectorAll("span")]
            .filter((span) => span.scrollWidth - span.clientWidth > 1 || span.scrollHeight - span.clientHeight > 1)
            .map((span) => `${tile.getAttribute("data-testid")}: ${(span.textContent ?? "").trim()}`),
        ),
      );
      expect(clipped, "tile text clipped at the largest text size").toEqual([]);
    });

    test("nothing on Home truncates to nothing", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);

      for (const testId of ["home-search-field", "home-machine-controls"]) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box, testId).not.toBeNull();
        expect(box!.width, testId).toBeGreaterThan(40);
        expect(box!.height, testId).toBeGreaterThanOrEqual(44);
      }

      // Every tile keeps a readable label rather than being clipped away.
      for (const tile of await page.locator('[data-testid^="home-tile-"]').all()) {
        const box = await tile.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(((await tile.textContent()) ?? "").trim().length).toBeGreaterThan(0);
      }
    });

    test("the overlay's rows meet the 44 px floor and keep their text", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("home-search-field").click();
      await page.getByTestId("search-input").fill("s");
      await expect(page.locator('[role="option"]').first()).toBeVisible();

      const rows = await page.locator('[role="option"]').all();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const box = await row.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(((await row.textContent()) ?? "").trim().length).toBeGreaterThan(0);
      }

      // The close button is a real target too, not a 24 px icon.
      const close = await page.getByTestId("search-close").boundingBox();
      expect(close!.height).toBeGreaterThanOrEqual(44);
      expect(close!.width).toBeGreaterThanOrEqual(44);
    });

    test("the page does not scroll sideways with the overlay open", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.getByTestId("home-search-field").click();
      // A query that matches long rows: every term has to match something in an entry, and
      // "configuration" matches nothing — "config" does not start with it.
      await page.getByTestId("search-input").fill("connection");
      await expect(page.locator('[role="option"]').first()).toBeVisible();

      const overflow = await page.evaluate(() => {
        const element = document.querySelector('[data-testid="search-results"]');
        return element === null ? 0 : element.scrollWidth - element.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
