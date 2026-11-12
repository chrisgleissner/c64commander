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
import { KEY_SELECTED_ATTRIBUTE as SELECTED, enableKeypad, ringFocus } from "./focusRing";

const MIN_TARGET_PX = 44;
const MIN_TEXT_PX = 14;
const MIN_BODY_TEXT_PX = 16;

const waitForAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );

test.describe("Remote Input BASIC commands, driven by keys alone at 320x426 @layout", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "BASIC command coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    await page.waitForTimeout(500);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);
    const openRemoteInput = page
      .locator('[data-slot-active="true"]')
      .getByTestId("home-machine-inline-openRemoteInput");
    expect(await ringFocus(page, openRemoteInput), "The ring could not reach Remote Input on Home").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("remote-input-sheet")).toBeVisible();
  });

  test.afterEach(async () => {
    await server.close();
  });

  const chooseFromMenu = async (page: Page, testId: string) => {
    await page.keyboard.press("F2");
    const menu = page.getByTestId("remote-input-controls-menu");
    await expect(menu).toBeVisible();
    await waitForAnimations(page);
    const item = menu.getByTestId(testId);
    for (let step = 0; step < 12 && !(await item.evaluate((el) => el === document.activeElement)); step += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(item).toBeFocused();
    return item;
  };

  const bufferWrites = () =>
    server.requests
      .filter((req) => req.method === "PUT" && req.url.startsWith("/v1/machine:writemem?address=0277"))
      .map((req) => new URL(req.url, "http://127.0.0.1").searchParams.get("data"));

  test('the controls menu runs LOAD"$",8 and writes it with RETURN to the keyboard buffer', async ({ page }) => {
    await (await chooseFromMenu(page, "remote-input-menu-keys")).press("Enter");
    await expect(page.getByTestId("remote-input-type-keyboard")).toBeVisible();

    const item = await chooseFromMenu(page, "remote-input-menu-basic-load-directory");
    const box = await item.boundingBox();
    expect(box!.height, "menu entry height").toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
    await page.keyboard.press("Enter");

    await expect.poll(() => bufferWrites().length, { timeout: 10_000 }).toBe(1);
    expect(bufferWrites()).toEqual(["4c4f41442224222c380d"]);
  });

  test("the BASIC commands row is reachable by the ring, with 44 px targets and readable text", async ({ page }) => {
    await (await chooseFromMenu(page, "remote-input-menu-keys")).press("Enter");
    await chooseFromMenu(page, "remote-input-menu-controls").then((item) => item.press("Enter"));

    const toggle = page.getByTestId("remote-input-basic-commands-toggle");
    expect(await ringFocus(page, toggle, 30), "The ring could not reach the BASIC commands toggle").toBe(true);
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const hint = page.getByTestId("remote-input-basic-commands-hint");
    await expect(hint).toHaveText("These work at the BASIC prompt.");
    const hintPx = await hint.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(hintPx, "hint text size").toBeGreaterThanOrEqual(MIN_BODY_TEXT_PX);

    for (const id of ["list", "run", "load-directory", "load-first-program"]) {
      const button = page.getByTestId(`remote-input-basic-command-${id}`);
      await button.scrollIntoViewIfNeeded();
      const measured = await button.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          w: rect.width,
          h: rect.height,
          px: Number.parseFloat(getComputedStyle(el).fontSize),
          right: rect.right,
        };
      });
      expect(measured.w, `${id} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
      expect(measured.h, `${id} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
      expect(measured.px, `${id} text size`).toBeGreaterThanOrEqual(MIN_TEXT_PX);
      expect(measured.right, `${id} right edge`).toBeLessThanOrEqual(320.5);
    }
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox!.height, "toggle height").toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
  });
});
