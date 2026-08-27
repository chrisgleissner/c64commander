/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { registerScreenshotSections, sanitizeSegment } from "./screenshotCatalog";
import { APP_STYLES, type AppStyleMode } from "../src/generated/appStyles";

/**
 * The style gallery (spec.md section 11): one screenshot per (style, mode, section) across all 12
 * palettes and the 9 sections `/dev/styles` renders, written to
 * docs/img/app/styles/<style-id>-<mode>-<section>.png.
 *
 * It does not reuse screenshots.spec.ts's capture machinery or its @screenshots tag: that pipeline
 * is built around pixel-deduping an evolving 273-file corpus, while this is a fixed, bounded
 * gallery run on demand. One test per (style, mode) keeps it to 12 page loads, not 108.
 */

const SCREENSHOT_ROOT = path.resolve("docs/img/app/styles");

const SECTION_SLUGS = [
  "app-bar",
  "cards",
  "buttons",
  "focus-and-selection",
  "inputs",
  "feedback",
  "overlays",
  "navigation",
  "data",
] as const;

const PALETTES: ReadonlyArray<{ styleId: string; mode: AppStyleMode }> = APP_STYLES.flatMap((style) =>
  (["light", "dark"] as const).filter((mode) => style[mode] !== undefined).map((mode) => ({ styleId: style.id, mode })),
);

const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("app-styles-gallery-page").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => document.readyState === "complete");
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForTimeout(300);
};

test.describe("Appearance style gallery screenshots", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Screenshot-only coverage; the gallery page is not interacted with.");
    server = await createMockC64Server();
    void page;
  });

  test.afterEach(async () => {
    await server.close();
  });

  test.beforeAll(async () => {
    await registerScreenshotSections(
      "styles",
      [...SECTION_SLUGS].map((slug) => sanitizeSegment(slug)),
    );
  });

  for (const palette of PALETTES) {
    test(`${palette.styleId} (${palette.mode})`, async ({ page }) => {
      await seedUiMocks(page, server.baseUrl);
      await page.addInitScript(() => {
        localStorage.setItem("c64u_feature_flag:app_styles_gallery_enabled", "1");
        sessionStorage.setItem("c64u_feature_flag:app_styles_gallery_enabled", "1");
      });
      await page.setViewportSize({ width: 500, height: 1200 });
      await page.goto(`/dev/styles?style=${palette.styleId}&mode=${palette.mode}`, {
        waitUntil: "domcontentloaded",
      });
      await settle(page);

      await fs.mkdir(SCREENSHOT_ROOT, { recursive: true });

      for (const slug of SECTION_SLUGS) {
        const section = page.getByTestId(`style-gallery-section-${slug}`);
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await expect(section).toBeVisible();
        const filePath = path.join(SCREENSHOT_ROOT, `${palette.styleId}-${palette.mode}-${slug}.png`);
        await section.screenshot({ path: filePath, animations: "disabled", caret: "hide" });
      }
    });
  }
});
