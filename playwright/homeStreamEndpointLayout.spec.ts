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
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";

/**
 * A stream row on Home shows its multicast address and port next to a label and two buttons. When the row is
 * too narrow the address must stay in one piece or break only after the colon, never inside a number.
 */

type EndpointLines = { id: string; text: string; lines: string[]; buttonsBelow: boolean };

const readEndpointLines = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-slot-active="true"] [data-testid^="home-stream-endpoint-display-"]',
      ),
    ].map((element) => {
      const text = element.textContent ?? "";
      const lines: string[] = [];
      let lineTop: number | null = null;
      let current = "";
      const range = document.createRange();
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let next = walker.nextNode(); next; next = walker.nextNode()) textNodes.push(next as Text);
      for (const textNode of textNodes) {
        for (let index = 0; index < textNode.length; index += 1) {
          range.setStart(textNode, index);
          range.setEnd(textNode, index + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0) continue;
          if (lineTop !== null && Math.abs(rect.top - lineTop) > 2) {
            lines.push(current);
            current = "";
          }
          lineTop = rect.top;
          current += textNode.data[index];
        }
      }
      if (current) lines.push(current);
      return { id: element.getAttribute("data-testid") ?? "", text, lines };
    }),
  );

test.describe("Home stream endpoints", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize({ width: 320, height: 427 });
  });

  test.afterEach(async () => {
    await server.close();
  });

  const WIDTHS = [320, 360, 393];
  for (const textScale of ["default", "largest"] as const) {
    for (const width of WIDTHS) {
      test(`stream rows break alike and never inside a number at ${width} px, ${textScale} text @layout`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 427 });
        await page.addInitScript(
          ({ scaleId, scale }: { scaleId: string; scale: string }) => {
            if (scale === "largest") localStorage.setItem("c64u_text_scale", scaleId);
            if (window.innerWidth <= 320) localStorage.setItem("c64u_display_profile_override", "compact");
          },
          { scaleId: LARGEST_TEXT_SCALE_ID, scale: textScale },
        );
        await page.goto("/");
        const toggle = page.locator('[data-slot-active="true"]').getByTestId("home-section-toggle-streams");
        await toggle.scrollIntoViewIfNeeded();
        await toggle.click();
        await expect(
          page.locator('[data-slot-active="true"] [data-testid="home-stream-endpoint-display-vic"]'),
        ).toBeVisible();

        const endpoints: EndpointLines[] = await readEndpointLines(page);
        expect(endpoints.length).toBeGreaterThanOrEqual(3);
        for (const endpoint of endpoints) {
          endpoint.lines.slice(0, -1).forEach((line, index) => {
            expect(line.endsWith(":"), `${endpoint.id}: line ${index + 1} "${line}" ends inside a number`).toBe(true);
          });
        }
        const placements = new Set(endpoints.map((endpoint) => endpoint.buttonsBelow));
        expect(placements.size, "some rows keep Start and Stop inline and others move them below").toBe(1);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
      });
    }
  }
});
