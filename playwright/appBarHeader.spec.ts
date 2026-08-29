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
      // The shape stays — it is what the badge is for, and its colour carries the state — while
      // the status word and the host are not drawn. innerText reports what is actually rendered.
      const drawn = ((await badge.innerText()) ?? "").trim();
      expect(drawn, "the header badge must not draw the status word").not.toMatch(/healthy|offline|unavailable/i);
      // The shape is an <svg>, so it is measured rather than read out of the text.
      const shape = badge.locator("svg[data-health-shape]");
      await expect(shape, "the health shape must still be drawn").toBeVisible();
      const shapeBox = await shape.boundingBox();
      expect(shapeBox?.width ?? 0, "the health shape must have a drawn size").toBeGreaterThan(0);

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

    /**
     * No ancestor of the health shape cuts a piece off it.
     *
     * Up to 0.10.0-rc2 the shape was a text character scaled up by 1.42x inside a box sized to the
     * unscaled character, and every ancestor between it and the button clips its overflow. On the
     * font CI and the Android WebView fall back to, that put roughly a quarter of the healthy
     * circle outside the row on the top and both sides, and the badge drew a flat-topped shape
     * instead of a circle. This measures the drawn shape against every clipping box above it, so
     * the same mistake in any form is caught wherever it is made.
     */
    test(`draws the health shape whole, uncut by any clipping ancestor, at the ${scaleId} text size @layout`, async ({
      page,
    }) => {
      await page.addInitScript((id: string) => localStorage.setItem("c64u_text_scale", id), scaleId);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settle(page);

      const shape = page.locator('[data-panel-position="1"] [data-testid="unified-health-badge"] svg');
      await expect(shape).toBeVisible();

      const cuts = await shape.evaluate((svg) => {
        const shapeRect = svg.getBoundingClientRect();
        const cuts: string[] = [];
        for (let node = svg.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.overflowX === "visible" && style.overflowY === "visible") {
            if (node.tagName === "HEADER") break;
            continue;
          }
          const clip = node.getBoundingClientRect();
          const over = {
            top: clip.top - shapeRect.top,
            bottom: shapeRect.bottom - clip.bottom,
            left: clip.left - shapeRect.left,
            right: shapeRect.right - clip.right,
          };
          for (const [side, amount] of Object.entries(over)) {
            // Half a pixel of rounding is not a cut; anything more is drawn and then thrown away.
            if (amount > 0.5) {
              cuts.push(
                `${node.tagName}.${node.className.toString().split(" ")[0]} cuts ${amount.toFixed(1)}px off ` +
                  `the ${side} of the shape`,
              );
            }
          }
          if (node.tagName === "HEADER") break;
        }
        return cuts;
      });

      expect(cuts, cuts.join("\n")).toEqual([]);
    });
  }
});
