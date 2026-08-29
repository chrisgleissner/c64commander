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
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";

/**
 * What the header spends its width on, on a phone.
 *
 * The header shares one row between the page title and the health badge. The badge used to draw
 * the host, the status glyph and the status word; the host was dropped below 430px because a
 * truncated IP address names nothing. The word went the same way for a different reason: it says
 * what the glyph's colour and the problem count already say, and nine wide letters of it left the
 * title wrapping onto a second line at the Large text size.
 *
 * A phone at 393px is on the medium display profile, not compact, so the compact profile's own
 * rules do not cover this. That is the case measured here.
 */
const PHONE = { width: 393, height: 727 };

test.describe("app bar header", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Header layout only; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize(PHONE);
  });

  test.afterEach(async () => {
    await server.close();
  });

  const settle = async (page: import("@playwright/test").Page) => {
    await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);
  };

  for (const scaleId of ["default", LARGEST_TEXT_SCALE_ID]) {
    test(`spends its width on the page title, not the status word, at the ${scaleId} text size @layout`, async ({
      page,
    }) => {
      await page.addInitScript((id: string) => localStorage.setItem("c64u_text_scale", id), scaleId);
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      await settle(page);

      const badge = page.getByTestId("unified-health-badge");
      await expect(badge).toBeVisible();
      // The glyph stays — it is what the badge is for, and its colour carries the state — while
      // the status word and the host are not drawn. innerText reports what is actually rendered.
      const drawn = ((await badge.innerText()) ?? "").trim();
      expect(drawn, "the header badge must not draw the status word").not.toMatch(/healthy|offline|unavailable/i);
      expect(drawn.length, "the glyph must still be drawn").toBeGreaterThan(0);

      // One line, drawn whole. Wrapping is what the status word was costing.
      const title = page.locator("header .c64-header").first();
      const lines = await title.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          rects: range.getClientRects().length,
          text: range.getBoundingClientRect().height,
          box: el.clientHeight,
        };
      });
      expect(lines.rects, "the page title must render on one line").toBe(1);
      expect(lines.box).toBeGreaterThanOrEqual(Math.ceil(lines.text));
    });
  }
});
