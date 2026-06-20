/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test } from "@playwright/test";

import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";

test.describe("Settings screen orientation", () => {
  test("persists Portrait, Landscape, and Auto choices from the Settings card", async ({ page }) => {
    const server = await createMockC64Server({});
    try {
      await seedUiMocks(page, server.baseUrl);
      await page.goto("/settings");
      const card = page.getByTestId("settings-screen-orientation-mode");

      await expect(card.getByRole("button", { name: "Portrait" })).toHaveClass(/bg-primary/);

      await card.getByRole("button", { name: "Landscape" }).click();
      await expect(card.getByRole("button", { name: "Landscape" })).toHaveClass(/bg-primary/);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("c64u_screen_orientation_mode")))
        .toBe("landscape");
      await expect.poll(() => page.evaluate(() => localStorage.getItem("c64u_auto_rotation_enabled"))).toBe("0");

      await card.getByRole("button", { name: "Auto" }).click();
      await expect(card.getByRole("button", { name: "Auto" })).toHaveClass(/bg-primary/);
      await expect.poll(() => page.evaluate(() => localStorage.getItem("c64u_screen_orientation_mode"))).toBe("auto");
      await expect.poll(() => page.evaluate(() => localStorage.getItem("c64u_auto_rotation_enabled"))).toBe("1");
    } finally {
      await server.close();
    }
  });
});
