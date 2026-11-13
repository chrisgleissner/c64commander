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
import { enableKeypad, ringFocus } from "./focusRing";

const CATEGORY = "Audio Output Settings";
const ITEM = "Speaker Output";
const DEFAULT_VALUE = "Enabled";

test.describe("Config shows what differs from the default and resets one item, by keypad only @layout", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Config default coverage; trace assertions disabled.");
    server = await createMockC64Server({
      [CATEGORY]: { [ITEM]: { value: "Disabled", options: ["Enabled", "Disabled"] } },
    });
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.route(/\/v1\/configs\/Audio(%20| )Output(%20| )Settings(\/Speaker(%20| )Output)?$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body[CATEGORY].items[ITEM].default = DEFAULT_VALUE;
      return route.fulfill({ response, json: body });
    });
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.goto("/config", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("a modified item is marked, and Reset to default writes the default over a single-item PUT", async ({
    page,
  }) => {
    const toggle = page.getByTestId("config-unrouted-toggle-audio-output-settings");
    expect(await ringFocus(page, toggle, 120)).toBe(true);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const marker = page.getByTestId("config-item-modified");
    await expect(marker).toContainText(`Modified. Default: ${DEFAULT_VALUE}`);
    await expect(marker).not.toContainText(/flash|saved/i);

    const reset = page.getByTestId("config-item-reset-default");
    const box = await reset.boundingBox();
    expect(box!.height, "Reset to default target height").toBeGreaterThanOrEqual(43.5);
    expect(box!.width, "Reset to default target width").toBeGreaterThanOrEqual(43.5);
    const fontPx = await reset.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(fontPx, "Reset to default text size").toBeGreaterThanOrEqual(14);
    expect(box!.x + box!.width, "Reset to default ends inside the 320 px viewport").toBeLessThanOrEqual(320);

    expect(await ringFocus(page, reset, 40)).toBe(true);
    const writesBefore = server.requests.filter((request) => request.method === "PUT").length;
    await page.keyboard.press("Enter");

    await expect
      .poll(
        () =>
          server.requests.filter(
            (request) =>
              request.method === "PUT" &&
              request.url.includes("/v1/configs/Audio%20Output%20Settings/Speaker%20Output") &&
              request.url.includes(`value=${DEFAULT_VALUE}`),
          ).length,
      )
      .toBe(1);
    expect(server.requests.filter((request) => request.method === "PUT").length).toBe(writesBefore + 1);
    expect(server.requests.some((request) => request.method === "POST" && request.url.endsWith("/v1/configs"))).toBe(
      false,
    );
    await expect(page.getByTestId("config-item-modified")).toHaveCount(0);
  });
});
