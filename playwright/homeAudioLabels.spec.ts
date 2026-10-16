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
 * The Audio card's SID shaping rows read "Reson", "Digis" and "Cap", and the keypad guidance bar
 * repeated them. They now carry the device's own item names, each whole on the 320 px screen.
 */
test("the Audio card names each SID shaping setting in full on the compact screen @layout", async ({
  page,
}, testInfo) => {
  disableTraceAssertions(testInfo, "Audio card labels only.");
  const server = await createMockC64Server({});
  await seedUiMocks(page, server.baseUrl);
  await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const main = page.locator('[data-slot-active="true"]');
    const toggle = main.locator("#home-section-toggle-audio");
    await toggle.waitFor({ timeout: 20_000 });
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const triggers = main.locator('[data-testid^="home-sid-shaping-"][role="combobox"]');
    await expect(triggers.first()).toBeVisible({ timeout: 20_000 });

    const labels = await triggers.evaluateAll((elements) =>
      elements.map((trigger) => {
        const label = document.getElementById(trigger.getAttribute("aria-labelledby") ?? "") as HTMLElement;
        const card = trigger.closest("section, [data-section-label]") as HTMLElement | null;
        const labelBox = label.getBoundingClientRect();
        const cardBox = card?.getBoundingClientRect();
        return {
          text: label.textContent ?? "",
          whole: label.scrollWidth <= label.clientWidth + 0.5,
          insideCard: cardBox ? labelBox.right <= cardBox.right + 0.5 && labelBox.left >= cardBox.left - 0.5 : true,
        };
      }),
    );
    const texts = labels.map((label) => label.text);
    for (const abbreviation of ["Reson", "Digis", "Cap", "Wave", "Resistor"]) expect(texts).not.toContain(abbreviation);
    expect(texts).toEqual(expect.arrayContaining(["Filter Resonance", "Digis Level", "Capacitors"]));
    for (const label of labels) expect(label, label.text).toMatchObject({ whole: true, insideCard: true });
  } finally {
    await server.close();
  }
});
