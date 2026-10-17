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
 * On the medium profile the Home drive cards sit two to a row. Drive A is open on a first visit and
 * Drive B is not, so a grid that stretches its cells drew Drive B as tall as Drive A with most of it
 * empty, and left the Soft IEC card alone in the third row at half the width.
 */
test("drive cards keep their own height and the odd card spans the row on the medium profile @layout", async ({
  page,
}, testInfo) => {
  disableTraceAssertions(testInfo, "Layout coverage; trace assertions disabled.");
  const server = await createMockC64Server({});
  await seedUiMocks(page, server.baseUrl);
  await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "medium"));
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.medium.viewport);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const toggle = page.locator('[data-slot-active="true"] #home-section-toggle-drives');
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();

    const group = page.getByTestId("home-drives-group");
    await expect(group).toBeVisible();
    const [groupBox, driveA, driveB, softIec] = await Promise.all(
      ["home-drives-group", "home-drive-row-a", "home-drive-row-b", "home-drive-row-soft-iec"].map((id) =>
        page.getByTestId(id).boundingBox(),
      ),
    );
    expect(driveA!.y, "drives A and B share a row").toBeCloseTo(driveB!.y, 0);
    expect(driveB!.height, "closed Drive B is not stretched to the height of open Drive A").toBeLessThan(
      driveA!.height,
    );
    expect(softIec!.y, "Soft IEC sits below A and B").toBeGreaterThan(driveA!.y + driveB!.height);
    expect(softIec!.width, "Soft IEC takes the whole row").toBeGreaterThanOrEqual(groupBox!.width - 1);
  } finally {
    await server.close();
  }
});
