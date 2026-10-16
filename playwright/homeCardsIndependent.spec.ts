/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad, ringFocus } from "./focusRing";

const openCard = async (toggle: Locator) => {
  if ((await toggle.getAttribute("aria-expanded")) === "true") return;
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
};

/*
 * Home cards open and close independently on every profile. The compact profile once closed the
 * other cards when one opened; that rule was removed, and a report of Lighting closing Drives on
 * the 320x427 screen is checked here by touch and by keypad.
 */
test("opening Lighting on the compact screen leaves CPU & RAM, Ports and Drives open @layout", async ({
  page,
}, testInfo) => {
  disableTraceAssertions(testInfo, "Card state coverage; trace assertions disabled.");
  const server = await createMockC64Server({});
  await seedUiMocks(page, server.baseUrl);
  await enableKeypad(page);
  await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const main = page.locator('[data-slot-active="true"]');
    const toggle = (id: string) => main.locator(`#home-section-toggle-${id}`);
    await expect(toggle("drives")).toBeVisible({ timeout: 20_000 });
    for (const id of ["cpu-ram", "ports", "drives"]) await openCard(toggle(id));

    await openCard(toggle("lighting"));
    for (const id of ["cpu-ram", "ports", "drives"]) {
      await expect(toggle(id), `${id} after Lighting opened by touch`).toHaveAttribute("aria-expanded", "true");
    }

    await toggle("lighting").click();
    await expect(toggle("lighting")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowDown");
    expect(await ringFocus(page, toggle("lighting"))).toBe(true);
    for (let press = 0; press < 2 && (await toggle("lighting").getAttribute("aria-expanded")) !== "true"; press += 1) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
    }
    await expect(toggle("lighting")).toHaveAttribute("aria-expanded", "true");
    for (const id of ["cpu-ram", "ports", "drives"]) {
      await expect(toggle(id), `${id} after Lighting opened by keypad`).toHaveAttribute("aria-expanded", "true");
    }
  } finally {
    await server.close();
  }
});
