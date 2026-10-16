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
 * A Home card header carrying an action ("Reset" on Audio and Printers) keeps it beside the title
 * whenever the two fit. On the 320 px screen the action used to sit on its own row directly under
 * the header, which doubled the height of every closed card and put Reset where a tap meant for
 * the header lands.
 */

type HeaderLayout = {
  id: string;
  cardHeight: number;
  sameRow: boolean;
  overlaps: boolean;
  titleClipped: boolean;
};

const readHeaders = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-slot-active="true"] [data-section-scope="home"]')]
      .filter((section) => section.getAttribute("data-open") === "false")
      .map((section) => {
        const toggle = section.querySelector<HTMLElement>("button[aria-expanded]");
        const action = [...section.querySelectorAll<HTMLElement>("button")].find(
          (button) => button.textContent?.trim() === "Reset",
        );
        if (!toggle || !action) return null;
        const toggleRect = toggle.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        const heading = toggle.querySelector("h2");
        return {
          id: section.getAttribute("data-section-id") ?? "",
          cardHeight: section.getBoundingClientRect().height,
          sameRow: actionRect.top >= toggleRect.top - 0.5 && actionRect.bottom <= toggleRect.bottom + 0.5,
          overlaps:
            actionRect.left < toggleRect.right - 0.5 &&
            actionRect.right > toggleRect.left + 0.5 &&
            actionRect.top < toggleRect.bottom - 0.5 &&
            actionRect.bottom > toggleRect.top + 0.5,
          titleClipped: heading ? heading.scrollHeight > heading.clientHeight + 1 : true,
        };
      })
      .filter((layout): layout is HeaderLayout => layout !== null),
  );

test.describe("Home card header actions", () => {
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

  test("a closed card keeps Reset beside its title on the 320 px screen @layout", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.goto("/");
    await expect(page.locator('[data-slot-active="true"] [data-section-id="printers"]')).toBeVisible();

    const headers = await readHeaders(page);
    expect(headers.map((header) => header.id)).toEqual(expect.arrayContaining(["audio", "printers"]));
    for (const header of headers) {
      expect(header.sameRow, `${header.id}: Reset is not on the header row`).toBe(true);
      expect(header.overlaps, `${header.id}: Reset overlaps the header`).toBe(false);
      expect(header.cardHeight, `${header.id}: the closed card is taller than one header row`).toBeLessThan(56);
      expect(header.titleClipped, `${header.id}: the title is clipped`).toBe(false);
    }
  });

  test("a header at the largest text size never clips its title to keep Reset beside it @layout", async ({ page }) => {
    await page.addInitScript((scaleId: string) => {
      localStorage.setItem("c64u_text_scale", scaleId);
      localStorage.setItem("c64u_display_profile_override", "compact");
    }, LARGEST_TEXT_SCALE_ID);
    await page.goto("/");
    await expect(page.locator('[data-slot-active="true"] [data-section-id="printers"]')).toBeVisible();

    const headers = await readHeaders(page);
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header.titleClipped, `${header.id}: the title is clipped`).toBe(false);
      expect(header.overlaps, `${header.id}: Reset overlaps the header`).toBe(false);
    }
  });
});
