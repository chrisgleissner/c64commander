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
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

/**
 * Game Mode: one action from "I want to play" to playing, and the physical keys
 * steering the right way whichever way the handset is held.
 *
 * Rotation is driven through the manual override rather than a sensor, which is
 * why that override is not only a fallback — it is what makes the whole feature
 * testable without turning a phone.
 */

const KEYPAD_FLAG_KEY = "c64u_feature_flag:keypad_input_enabled";

const enableKeypad = (page: Page) =>
  page.addInitScript(
    ({ flagKey }: { flagKey: string }) => {
      try {
        localStorage.setItem(flagKey, "1");
      } catch (error) {
        if (location.origin !== "null") throw error;
      }
    },
    { flagKey: KEYPAD_FLAG_KEY },
  );

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    { timeout: 10000 },
  );
};

const expectInGameMode = async (page: Page) => {
  await expect(page.getByTestId("remote-input-sheet")).toBeVisible();
  await expect(page.getByTestId("remote-input-sheet")).toHaveAttribute("data-game-mode", "true");
};

test.describe("Game Mode", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("the Home tile opens the sheet already in game mode, with no second step", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-machine-inline-openGameMode").click();
    await expectInGameMode(page);

    // The chrome is already collapsed: the floating handle is the way back to it,
    // and the button that used to be the second step no longer exists.
    await expect(page.getByTestId("remote-input-restore-chrome")).toBeVisible();
    await expect(page.getByTestId("remote-input-collapse-chrome")).toHaveCount(0);
  });

  test("Game Mode is the first Quick Action tile, ahead of every destructive one", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    const labels = await page
      .locator('[data-panel-position="1"] [data-testid="home-machine-controls"] button')
      .allInnerTexts();
    expect(labels[0]?.trim()).toBe("Game Mode");

    const destructive = ["Reset", "Reboot", "Reboot (Clr Mem)", "Power Cycle", "Power Off"];
    const trimmed = labels.map((label) => label.trim());
    const firstDestructive = trimmed.findIndex((label) => destructive.includes(label));
    const lastSafe = trimmed.reduce((last, label, index) => (destructive.includes(label) ? last : index), -1);
    expect(firstDestructive).toBeGreaterThan(lastSafe);
  });

  test("`0` enters game mode from Home, Play and Settings", async ({ page }) => {
    await enableKeypad(page);
    for (const path of ["/", "/play", "/settings"]) {
      await page.goto(path);
      await waitForConnected(page);

      await page.keyboard.press("0");
      await expectInGameMode(page);

      // Back leaves; `0` only ever enters.
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("remote-input-sheet")).toBeHidden();
    }
  });

  test("`0` is inert while a text field holds the ring", async ({ page }) => {
    await enableKeypad(page);
    await page.goto("/play");
    await waitForConnected(page);

    const field = page.locator('[data-slot-active="true"] input:not([type="file"]):not([type="checkbox"])').first();
    await field.click();
    await field.press("0");
    await page.waitForTimeout(500);

    await expect(page.getByTestId("remote-input-sheet")).toBeHidden();
  });

  test("the Quick Menu carries the same entry", async ({ page }) => {
    await enableKeypad(page);
    await page.goto("/");
    await waitForConnected(page);

    await page.keyboard.press("ContextMenu");
    await expect(page.getByTestId("keypad-quick-menu")).toBeVisible();
    await page.getByTestId("keypad-quick-menu-game-mode").click();

    await expectInGameMode(page);
  });

  test("the picture turns with the handset while the app stays portrait", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    // The mirror only renders with a live picture, so seed the video mirror as live.
    await page.getByTestId("home-machine-inline-openGameMode").click();
    await expectInGameMode(page);
    await page.getByTestId("remote-input-restore-chrome").click();

    const appRoot = page.locator("#root, body").first();
    const beforeAppBox = await appRoot.boundingBox();

    for (const [angle, expected] of [
      ["90", "90"],
      ["270", "270"],
      ["0", "0"],
    ] as const) {
      await page.getByTestId(`remote-input-rotation-${angle}`).click();
      await expect(page.getByTestId("remote-input-rotation-override")).toHaveAttribute("data-rotation", expected);
      const mirror = page.getByTestId("av-mirror-immersive");
      if (await mirror.count()) {
        await expect(mirror).toHaveAttribute("data-rotation", expected);
        // Only the picture turns: the stage carries the counter-rotation, and the app frame
        // around it is untouched.
        const stageTransform = await page
          .getByTestId("av-mirror-immersive-stage")
          .evaluate((el) => getComputedStyle(el).transform);
        expect(stageTransform).not.toBe("none");
      }
      // GM-11: nothing else in the app rotates — the page box is unchanged at every angle.
      expect(await appRoot.boundingBox()).toEqual(beforeAppBox);
    }
  });

  test("the physical keys steer the way the handset is held", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-machine-inline-openGameMode").click();
    await expectInGameMode(page);
    await page.getByTestId("remote-input-restore-chrome").click();

    const sheet = page.getByTestId("remote-input-sheet");

    // `data-held-joystick` is what the sheet asks the transport to hold, so the assertion is
    // the relayed direction rather than a repaint. Classic T9 is the general edition's
    // default: `4` is LEFT when the handset is upright, and the same key is UP once it has
    // been turned a quarter clockwise — one binding under one permutation.
    const holdWhileTurned = async (angle: "0" | "90" | "270") => {
      await page.getByTestId(`remote-input-rotation-${angle}`).click();
      await expect(page.getByTestId("remote-input-rotation-override")).toHaveAttribute("data-rotation", angle);
      await sheet.dispatchEvent("keydown", { code: "Digit4", key: "4" });
      await page.waitForTimeout(250);
      const held = await sheet.getAttribute("data-held-joystick");
      await sheet.dispatchEvent("keyup", { code: "Digit4", key: "4" });
      await page.waitForTimeout(250);
      return { held, released: await sheet.getAttribute("data-held-joystick") };
    };

    expect(await holdWhileTurned("0")).toEqual({ held: "left", released: "" });
    expect(await holdWhileTurned("90")).toEqual({ held: "up", released: "" });
    expect(await holdWhileTurned("270")).toEqual({ held: "down", released: "" });
  });

  // GM-9: the keys held do not change when the handset turns, but what they mean does.
  test("a turn while a key is held releases the old direction and asserts the new one", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-machine-inline-openGameMode").click();
    await expectInGameMode(page);
    await page.getByTestId("remote-input-restore-chrome").click();

    const sheet = page.getByTestId("remote-input-sheet");
    await sheet.dispatchEvent("keydown", { code: "Digit4", key: "4" });
    await expect(sheet).toHaveAttribute("data-held-joystick", "left");

    await page.getByTestId("remote-input-rotation-90").click();
    // No diagonal: `left` must be gone, not merely joined by `up`.
    await expect(sheet).toHaveAttribute("data-held-joystick", "up");

    await sheet.dispatchEvent("keyup", { code: "Digit4", key: "4" });
    await expect(sheet).toHaveAttribute("data-held-joystick", "");
  });

  test("the orientation override turns the picture and nothing else", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-machine-inline-openGameMode").click();
    await expectInGameMode(page);
    // The override rides Game Mode's chrome, which the floating handle brings back.
    await page.getByTestId("remote-input-restore-chrome").click();

    const override = page.getByTestId("remote-input-rotation-override");
    await expect(override).toHaveAttribute("data-source", "auto");
    await expect(override).toHaveAttribute("data-rotation", "0");

    await page.getByTestId("remote-input-rotation-90").click();
    await expect(override).toHaveAttribute("data-source", "pinned");
    await expect(override).toHaveAttribute("data-rotation", "90");

    await page.getByTestId("remote-input-rotation-auto").click();
    await expect(override).toHaveAttribute("data-source", "auto");
    await expect(override).toHaveAttribute("data-rotation", "0");
  });
});
