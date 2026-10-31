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

const PROFILES = ["compact", "medium"] as const;
const KEYPAD_DEFAULTS = [
  { name: "broad edition defaults", keypad: false },
  { name: "compact keypad edition defaults", keypad: true },
] as const;

const startInSidPlayer = async (page: Page, profile: (typeof PROFILES)[number], keypad: boolean, baseUrl: string) => {
  await seedUiMocks(page, baseUrl);
  if (keypad) await enableKeypad(page);
  await page.addInitScript((override) => {
    localStorage.setItem("c64u_display_profile_override", override);
    localStorage.setItem("c64u_startup_mode", "sid-player");
  }, profile);
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
};

for (const profile of PROFILES) {
  for (const { name, keypad } of KEYPAD_DEFAULTS) {
    test.describe(`SID Player at the ${profile} profile with ${name}`, () => {
      let server: Awaited<ReturnType<typeof createMockC64Server>>;

      test.beforeEach(async ({ page }, testInfo) => {
        disableTraceAssertions(testInfo, "SID Player mode coverage; trace assertions disabled.");
        server = await createMockC64Server({});
        await startInSidPlayer(page, profile, keypad, server.baseUrl);
      });

      test.afterEach(async () => {
        await server.close();
      });

      test("SPM-MODE-03 opens on Play with only the three tabs and a SID Player badge", async ({ page }) => {
        await page.goto("/");
        await expect(page).toHaveURL(/\/play$/);
        await expect(page.getByTestId("tab-play")).toBeVisible();
        await expect(page.getByTestId("tab-settings")).toBeVisible();
        await expect(page.getByTestId("tab-docs")).toBeVisible();
        for (const hidden of ["tab-home", "tab-disks", "tab-config"]) {
          await expect(page.getByTestId(hidden)).toHaveCount(0);
        }
        await expect(page.getByTestId("unified-health-badge")).toContainText("SID Player");
      });

      test("SPM-NET-01 a session across the pages sends no request to the device and shows no toast", async ({
        page,
      }) => {
        await page.goto("/");
        for (const tab of ["tab-settings", "tab-docs", "tab-play"]) {
          await page.getByTestId(tab).click();
          await page.waitForTimeout(400);
        }
        await page.waitForTimeout(3000);
        expect(server.requests).toEqual([]);
        await expect(page.getByTestId("app-toast")).toHaveCount(0);
      });

      test("SPM-MODE-03 the machine choice and the device switcher are not offered on Play or in the Quick menu", async ({
        page,
      }) => {
        await page.goto("/play");
        await expect(page.getByTestId("start-listening")).toBeVisible();
        await expect(page.getByTestId("playback-engine-toggle")).toHaveCount(0);
        await page.getByTestId("app-bar-quick-menu").click();
        await expect(page.getByTestId("keypad-quick-menu-leave-sid-player")).toBeVisible();
        await expect(page.getByTestId("keypad-quick-menu-switch-device")).toHaveCount(0);
      });

      test("SPM-SET-01 Settings keeps the standalone sections and drops the machine ones", async ({ page }) => {
        await page.goto("/settings");
        await expect(page.getByTestId("settings-section-app-mode")).toBeVisible();
        await expect(page.getByTestId("settings-section-appearance")).toBeVisible();
        for (const hidden of ["connection", "device-safety"]) {
          await expect(page.getByTestId(`settings-section-${hidden}`)).toHaveCount(0);
        }
      });

      test("SPM-PLAY-07 Play a station opens the SID Radio launcher without touching the device", async ({ page }) => {
        await page.goto("/play");
        await page.getByTestId("start-listening-station").click();
        await expect(page.getByTestId("sid-radio-launcher-sheet")).toBeVisible();
        expect(server.requests).toEqual([]);
      });

      test("SPM-START-03 the Start listening area is on screen within three seconds of the page loading", async ({
        page,
      }) => {
        await page.goto("/play", { waitUntil: "domcontentloaded" });
        await page.getByTestId("start-listening").waitFor({ state: "visible", timeout: 3000 });
        const sinceNavigation = await page.evaluate(() => Math.round(performance.now()));
        console.log(`SPM-START-03 start-listening visible ${sinceNavigation} ms after navigation start`);
        expect(sinceNavigation).toBeLessThan(3000);
      });

      test("SPM-PLAY-01 Add items offers no C64U source", async ({ page }) => {
        await page.goto("/play");
        await page.getByTestId("add-items-to-playlist").click();
        await expect(page.getByTestId("import-option-local")).toBeVisible();
        await expect(page.getByTestId("import-option-c64u")).toHaveCount(0);
      });

      test("SPM-MODE-04 a round trip through Full App keeps the playlist, saved devices and settings", async ({
        page,
      }) => {
        await page.goto("/");
        await page.getByTestId("tab-settings").click();
        const snapshot = () =>
          page.evaluate(() =>
            Object.fromEntries(
              Object.keys(localStorage)
                .filter((key) => /playlist|saved_devices|feature_flag|liked|recent|settings/i.test(key))
                .sort()
                .map((key) => {
                  const value = localStorage.getItem(key);
                  if (!key.startsWith("c64u_saved_devices")) return [key, value];
                  const saved = JSON.parse(value ?? "{}") as {
                    selectedDeviceId?: string;
                    devices?: Array<{ id: string; host: string; name: string }>;
                  };
                  const devices = (saved.devices ?? []).map(({ id, host, name }) => ({ id, host, name }));
                  return [key, JSON.stringify({ selectedDeviceId: saved.selectedDeviceId, devices })];
                }),
            ),
          );
        const section = page.getByTestId("settings-section-app-mode");
        await section.scrollIntoViewIfNeeded();
        if (!(await page.getByTestId("device-less-choice-full-app").isVisible())) {
          await section.getByRole("button").first().click();
        }
        const before = await snapshot();
        await page.getByTestId("device-less-choice-full-app").click();
        await page.getByTestId("mode-dialog-leave-full-app").click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem("c64u_startup_mode"))).toBe("default");
        await page.getByTestId("device-less-choice-sid-player").click();
        await page.getByTestId("mode-dialog-enter-confirm").click();
        await expect.poll(() => page.evaluate(() => localStorage.getItem("c64u_startup_mode"))).toBe("sid-player");
        expect(await snapshot()).toEqual(before);
      });
    });
  }
}

for (const profile of PROFILES) {
  test.describe(`The Quick menu entry for SID Player at the ${profile} profile`, () => {
    let server: Awaited<ReturnType<typeof createMockC64Server>>;

    test.beforeEach(async ({ page }, testInfo) => {
      disableTraceAssertions(testInfo, "Quick menu entry coverage; trace assertions disabled.");
      server = await createMockC64Server({});
      await seedUiMocks(page, server.baseUrl);
      await enableKeypad(page);
      await page.addInitScript((override) => localStorage.setItem("c64u_display_profile_override", override), profile);
      await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
    });

    test.afterEach(async () => {
      await server.close();
    });

    test("SPM-QM-01 the Full App Quick menu reaches SID Player by keypad and the switch is reversible", async ({
      page,
    }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("tab-home")).toBeVisible();
      await page.keyboard.press("ContextMenu");
      const entry = page.getByTestId("keypad-quick-menu-use-sid-player");
      await expect(entry).toBeVisible();
      expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await ringFocus(page, entry)).toBe(true);
      await page.keyboard.press("Enter");

      expect(await ringFocus(page, page.getByTestId("mode-dialog-enter-confirm"))).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/play$/);
      await expect(page.getByTestId("tab-home")).toHaveCount(0);
      await expect(page.getByTestId("mode-dialog-enter")).toHaveCount(0);

      await page.keyboard.press("ContextMenu");
      await expect(page.getByTestId("keypad-quick-menu-use-sid-player")).toHaveCount(0);
      const leave = page.getByTestId("keypad-quick-menu-leave-sid-player");
      expect(await ringFocus(page, leave)).toBe(true);
      await page.keyboard.press("Enter");
      expect(await ringFocus(page, page.getByTestId("mode-dialog-leave-full-app"))).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("tab-home")).toBeVisible();
    });
  });
}
