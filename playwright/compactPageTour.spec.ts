/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";

/**
 * Saves every primary page at the smallest supported panel (320 px wide) with its whole scroll height
 * visible, so a layout can be reviewed top to bottom in one image per page.
 *
 * Skipped unless COMPACT_PAGE_TOUR names the directory to write to. It asserts nothing: it is a review
 * aid, next to compactUsability.spec.ts, which asserts on the surfaces that open over these pages.
 */
const OUT_DIR = process.env.COMPACT_PAGE_TOUR;

test.skip(!OUT_DIR, "Set COMPACT_PAGE_TOUR to a directory to save the page tour.");
test.use({ viewport: { width: 320, height: 427 }, deviceScaleFactor: 1 });

const ROUTES = [
  ["home", "/"],
  ["play", "/play"],
  ["disks", "/disks"],
  ["config", "/config"],
  ["settings", "/settings"],
  ["docs", "/docs"],
] as const;

const expandEverything = async (page: Page) => {
  const toggles = page.locator('[data-testid*="-section-toggle-"][aria-expanded="false"]');
  const count = await toggles.count();
  for (let index = 0; index < count; index += 1) {
    await toggles
      .nth(0)
      .click({ timeout: 2000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(400);
};

test("every primary page, full height, expanded", async ({ page }, testInfo) => {
  disableTraceAssertions(testInfo, "Review aid; no trace assertions.");
  const server = await createMockC64Server({});
  try {
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
      localStorage.setItem(
        "c64u_tour_state:v1",
        JSON.stringify({ completedAt: 1735689600000, skippedAt: null, lastStepId: null, deviceStepsPending: false }),
      );
    });
    for (const [name, route] of ROUTES) {
      await page.setViewportSize({ width: 320, height: 427 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.locator("main").first().waitFor({ state: "attached", timeout: 15_000 });
      await page.waitForTimeout(800);
      await expandEverything(page);
      const height = await page.evaluate(() => {
        const main = document.querySelector("[data-slot-active='true'] main") ?? document.querySelector("main");
        return main ? main.scrollHeight : document.documentElement.scrollHeight;
      });
      await page.setViewportSize({ width: 320, height: Math.min(height + 150, 9000) });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
    }
  } finally {
    await server.close();
  }
});
