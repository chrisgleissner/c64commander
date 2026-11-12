/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad, ringFocus } from "./focusRing";
import { installLiveViewStreamStub } from "./liveViewStreamStub";

const MIN_TARGET_PX = 44;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test.describe("Live View screenshot of the C64 screen @layout", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Live View screenshot coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await installLiveViewStreamStub(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.goto("/");
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    await page.getByTestId("home-machine-inline-openGameMode").click();
    await expect(page.getByTestId("remote-input-sheet")).toHaveAttribute("data-game-mode", "true");
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("the control row still fits at 320 px with every control at full size", async ({ page }) => {
    const controls = page.getByTestId("av-mirror-immersive-controls");
    await expect(controls).toBeVisible({ timeout: 15_000 });
    const row = await controls.boundingBox();
    expect(row!.x, "row left edge").toBeGreaterThanOrEqual(0);
    expect(row!.x + row!.width, "row right edge").toBeLessThanOrEqual(320.5);

    const buttons = await controls.locator("button").all();
    expect(buttons.length).toBe(6);
    for (const button of buttons) {
      const box = await button.boundingBox();
      const name = (await button.getAttribute("aria-label")) ?? "?";
      expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
      expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
    }
  });

  test("the keypad saves a PNG of the decoded frame at its native size", async ({ page }) => {
    await expect(page.getByTestId("av-mirror-immersive-controls")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("F2");
    const item = page.getByTestId("remote-input-controls-menu").getByTestId("remote-input-menu-screenshot");
    await expect(item).toBeVisible();
    await page.evaluate(() =>
      Promise.allSettled(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      ),
    );
    const box = await item.boundingBox();
    expect(box!.height, "Save screenshot menu entry height").toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
    expect(await ringFocus(page, item, 12), "the keypad could not reach Save screenshot").toBe(true);

    const download = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^c64-screen-\d{8}-\d{6}\.png$/);
    const bytes = fs.readFileSync((await file.path())!);
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }).toEqual({ width: 384, height: 272 });
    await expect(page.getByTestId("app-toast").filter({ hasText: "Screenshot saved" })).toBeVisible();
  });
});
