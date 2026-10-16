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
import { enableKeypad } from "./focusRing";

/*
 * The licenses used to cover the whole screen, guidance bar included, cut the bottom link off
 * against the edge of its card, and offered 31 x 21 px "MIT" links.
 */
test("the licenses sheet keeps the guidance bar and shows each selected link whole @layout", async ({
  page,
}, testInfo) => {
  disableTraceAssertions(testInfo, "Licenses layout coverage; trace assertions disabled.");
  const server = await createMockC64Server({});
  await seedUiMocks(page, server.baseUrl);
  await enableKeypad(page);
  await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  try {
    await page.goto("/settings/open-source-licenses", { waitUntil: "domcontentloaded" });
    const sheet = page.getByTestId("open-source-licenses-overlay");
    await expect(sheet.getByTestId("open-source-license-card").first()).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByText(/THIRD_PARTY_NOTICES/)).toHaveCount(0);

    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      const selected = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const box = element.getBoundingClientRect();
        const body = element.closest('[data-surface-body="true"]')?.getBoundingClientRect();
        const bar = document.querySelector('[data-testid="keypad-guidance-bar"]')?.getBoundingClientRect();
        return {
          tag: element.tagName,
          height: box.height,
          width: box.width,
          insideBody: body ? box.top >= body.top - 0.5 && box.bottom <= body.bottom + 0.5 : false,
          aboveBar: bar ? box.bottom <= bar.top + 0.5 : true,
        };
      });
      if (selected.tag !== "A") continue;
      expect(selected, `link after ${press + 1} presses`).toMatchObject({ insideBody: true, aboveBar: true });
      expect(selected.height).toBeGreaterThanOrEqual(44);
      expect(selected.width).toBeGreaterThanOrEqual(44);
    }

    const bar = page.getByTestId("keypad-guidance-bar");
    await expect(bar).toBeVisible();
    const barTop = await bar.evaluate((element) => element.getBoundingClientRect().top);
    const sheetBottom = await sheet.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(sheetBottom, "the sheet runs under the guidance bar").toBeLessThanOrEqual(barTop + 0.5);
  } finally {
    await server.close();
  }
});
