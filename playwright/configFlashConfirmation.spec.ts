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
import { enableKeypad, ringFocus } from "./focusRing";

const MIN_TARGET_PX = 44;

test.describe("Config Load and Reset ask before running, operated by keys alone @layout", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Confirmation coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.goto("/");
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    await page.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await server.close();
  });

  const configWrites = (path: string) =>
    server.requests.filter((request) => request.method === "PUT" && request.url.includes(path));

  const reachTile = async (page: Page, name: string) => {
    const section = page.getByTestId("home-config-actions");
    expect(await ringFocus(page, section, 160)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(section).toHaveAttribute("data-open", "true");
    const tile = page.getByRole("button", { name, exact: true });
    expect(await ringFocus(page, tile, 160)).toBe(true);
    return tile;
  };

  test("Load from flash sends nothing until the confirmation is accepted with the keypad", async ({ page }) => {
    await reachTile(page, "Load config from flash");
    await page.keyboard.press("Enter");

    const dialog = page.getByTestId("machine-action-confirmation");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Load config from flash?");
    expect(configWrites("load_from_flash")).toHaveLength(0);

    const confirm = dialog.getByRole("button", { name: "Load" });
    const box = await confirm.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
    expect(await ringFocus(page, confirm, 12)).toBe(true);
    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => configWrites("load_from_flash").length).toBe(1);
  });

  test("Reset to default is canceled by keypad without reaching the device", async ({ page }) => {
    await reachTile(page, "Reset config to default");
    await page.keyboard.press("Enter");

    const dialog = page.getByTestId("machine-action-confirmation");
    await expect(dialog).toContainText("Reset config to default?");
    await page.keyboard.press("Escape");

    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(configWrites("reset_to_default")).toHaveLength(0);
  });

  test("Reset to default runs once after the keypad confirms it", async ({ page }) => {
    await reachTile(page, "Reset config to default");
    await page.keyboard.press("Enter");

    const dialog = page.getByTestId("machine-action-confirmation");
    expect(await ringFocus(page, dialog.getByRole("button", { name: "Reset" }), 12)).toBe(true);
    await page.keyboard.press("Enter");

    await expect.poll(() => configWrites("reset_to_default").length).toBe(1);
  });
});
