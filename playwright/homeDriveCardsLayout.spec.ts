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

/*
 * The Home Drives card is one line per drive ("A · #8 · 1541 · No disk"). The line opens the Disks
 * page, the ON/OFF pill and a details chevron sit beside it, and bus, type, disk and status are
 * behind the chevron. Before this, Drive A was open on a first visit: on the 320 px profile the
 * three drives took about 390 px, and on the 393 px profile Drive B was stretched beside Drive A.
 */
for (const profile of ["compact", "medium"] as const) {
  test(`drives are three single-line rows of at least 44 px on the ${profile} profile @layout`, async ({
    page,
  }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout coverage; trace assertions disabled.");
    const server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript((override) => localStorage.setItem("c64u_display_profile_override", override), profile);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const toggle = page.locator('[data-slot-active="true"] #home-section-toggle-drives');
      await expect(toggle).toBeVisible({ timeout: 20_000 });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();

      const suffixes = ["a", "b", "soft-iec"];
      const rows = await Promise.all(
        suffixes.map((suffix) => page.getByTestId(`home-drive-row-${suffix}`).boundingBox()),
      );
      const [rowA, rowB, rowSoftIec] = rows;
      expect(rowB!.y, "B sits below A").toBeGreaterThan(rowA!.y);
      expect(rowSoftIec!.y, "Soft IEC sits below B").toBeGreaterThan(rowB!.y);
      expect(rowB!.width, "rows share one column").toBeCloseTo(rowA!.width, 0);
      for (const [index, row] of rows.entries()) {
        expect(row!.height, `${suffixes[index]} row is one line`).toBeLessThan(56);
      }

      for (const suffix of suffixes) {
        for (const control of ["link", "toggle", "details-toggle"]) {
          const box = await page.getByTestId(`home-drive-${control}-${suffix}`).boundingBox();
          expect(box!.height, `${control} ${suffix} height`).toBeGreaterThanOrEqual(43.5);
          expect(box!.width, `${control} ${suffix} width`).toBeGreaterThanOrEqual(43.5);
        }
      }

      await page.getByTestId("home-drive-details-toggle-a").click();
      for (const control of ["bus", "type", "status"]) {
        await expect(page.getByTestId(`home-drive-${control}-a`)).toBeVisible();
      }
    } finally {
      await server.close();
    }
  });
}

test("the summary line of a drive opens the Disks page @layout", async ({ page }, testInfo) => {
  disableTraceAssertions(testInfo, "Layout coverage; trace assertions disabled.");
  const server = await createMockC64Server({});
  await seedUiMocks(page, server.baseUrl);
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.medium.viewport);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const toggle = page.locator('[data-slot-active="true"] #home-section-toggle-drives');
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await page.getByTestId("home-drive-link-a").click();
    await expect(page).toHaveURL(/\/disks$/);
  } finally {
    await server.close();
  }
});
