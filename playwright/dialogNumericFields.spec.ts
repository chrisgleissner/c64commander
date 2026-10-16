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
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad } from "./focusRing";

const activeTestId = (page: Page) =>
  page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.testid ?? document.activeElement?.tagName,
  );

const pressDownUntil = async (page: Page, testId: string, limit = 12) => {
  const seen: (string | undefined)[] = [];
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press("ArrowDown");
    const current = await activeTestId(page);
    seen.push(current);
    if (current === testId) return seen;
  }
  return seen;
};

test.describe("Numeric fields in dialogs on the keypad", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Keypad field coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  /*
   * Selecting a numeric field used to focus its input. On the keypad handset the system keyboard
   * then opened and took half of the 427 px screen, hiding the FTP and Telnet port fields under the
   * dialog header and the Add button. The keypad now stops on the field's row; OK starts editing.
   */
  test("the keypad selects the Add device port fields without editing them; OK edits and returns", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings-add-device").click();
    await expect(page.getByTestId("settings-add-device-dialog")).toBeVisible();
    await page.waitForTimeout(400);

    const seen = await pressDownUntil(page, "add-device-http-field");
    expect(seen.at(-1), `stops walked: ${seen.join(", ")}`).toBe("add-device-http-field");
    expect(seen).not.toContain("add-device-http");

    await page.keyboard.press("Enter");
    expect(await activeTestId(page)).toBe("add-device-http");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("8080");
    await expect(page.getByTestId("add-device-http")).toHaveValue(/8080$/);

    await page.keyboard.press("Enter");
    expect(await activeTestId(page)).toBe("add-device-http-field");
    await page.keyboard.press("ArrowDown");
    expect(await activeTestId(page)).toBe("add-device-ftp-field");
    await expect(page.getByTestId("settings-add-device-dialog")).toBeVisible();
  });

  test("Down from inside an edited port field moves to the next field's row", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByTestId("settings-add-device").click();
    await expect(page.getByTestId("settings-add-device-dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await pressDownUntil(page, "add-device-ftp-field");

    await page.keyboard.press("Enter");
    expect(await activeTestId(page)).toBe("add-device-ftp");
    await page.keyboard.press("ArrowDown");

    expect(await activeTestId(page)).toBe("add-device-telnet-field");
  });

  test("the keypad selects New disk Tracks without editing it; OK edits", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("c64u_feature_flag:new_disk_enabled", "1"));
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await page.locator('[data-slot-active="true"]').getByTestId("new-disk-open").click();
    await expect(page.getByRole("dialog", { name: "New disk" })).toBeVisible();
    await page.waitForTimeout(400);

    const seen = await pressDownUntil(page, "new-disk-tracks-field", 16);
    expect(seen.at(-1), `stops walked: ${seen.join(", ")}`).toBe("new-disk-tracks-field");
    expect(seen).not.toContain("new-disk-tracks");

    await page.keyboard.press("Enter");
    expect(await activeTestId(page)).toBe("new-disk-tracks");
  });

  test("Back while editing New disk Tracks returns to the row and keeps the dialog; a second Back closes it", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("c64u_feature_flag:new_disk_enabled", "1"));
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await page.locator('[data-slot-active="true"]').getByTestId("new-disk-open").click();
    const dialog = page.getByRole("dialog", { name: "New disk" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    await pressDownUntil(page, "new-disk-tracks-field", 16);
    await page.keyboard.press("Enter");
    expect(await activeTestId(page)).toBe("new-disk-tracks");
    await page.getByTestId("new-disk-tracks").fill("40");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(await activeTestId(page)).toBe("new-disk-tracks-field");
    await expect(page.getByTestId("new-disk-tracks")).toHaveValue("40");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  /*
   * Where the system keyboard does open (a tap on a touch phone), it leaves about 213 of the 427 px.
   * The field being edited must stay in sight inside the dialog, not under its title or buttons.
   */
  for (const field of ["add-device-http", "add-device-ftp", "add-device-telnet"]) {
    test(`${field} stays visible while edited with the keyboard taking half the screen`, async ({ page }) => {
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await page.getByTestId("settings-add-device").click();
      await expect(page.getByTestId("settings-add-device-dialog")).toBeVisible();
      await page.getByTestId(field).click();
      await page.setViewportSize({ width: 320, height: 213 });
      await page.waitForTimeout(500);

      const covering = await page.getByTestId(field).evaluate((input) => {
        const box = input.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          onScreen: box.top >= 0 && box.bottom <= window.innerHeight,
          hit: hit === input ? "self" : ((hit as HTMLElement | null)?.dataset.testid ?? hit?.tagName ?? "nothing"),
        };
      });
      expect(covering).toEqual({ onScreen: true, hit: "self" });
      // The buttons are still there, one scroll away.
      await page.getByTestId("settings-add-device-confirm").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("settings-add-device-confirm")).toBeInViewport();
    });
  }
});
