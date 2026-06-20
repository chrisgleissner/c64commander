/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Real-browser small-screen layout gate for the Commodore Callback 8020
 * (3.25" / 480x640) and a narrower 320x480 fallback. Complements the
 * deterministic jsdom display-profile contract test
 * (tests/unit/lib/smallScreenLayout.test.ts) with an actual layout engine, and
 * the existing layoutOverflow.spec.ts (compact/medium/expanded profiles).
 *
 * It asserts no horizontal overflow on the offline app shell across every
 * primary tab route — the offline shell is exactly the Callback's manual-IP
 * first-run state, so no mock device is needed.
 */

import { test, expect, type Page } from "@playwright/test";

import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { applyDisplayProfileViewport } from "./displayProfileViewportUtils";
import { seedUiMocks } from "./uiMocks";

const VIEWPORTS = [
  { name: "callback-480x640", width: 480, height: 640 },
  { name: "fallback-320x480", width: 320, height: 480 },
] as const;

const PRIMARY_ROUTES = ["/", "/play", "/disks", "/config", "/settings", "/docs"] as const;

const expectNoHorizontalOverflow = async (page: Page, label: string) => {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.doc, `${label}: document horizontal overflow (vw=${overflow.viewport})`).toBeLessThanOrEqual(1);
  expect(overflow.body, `${label}: body horizontal overflow (vw=${overflow.viewport})`).toBeLessThanOrEqual(1);
};

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at ${vp.name} across primary routes`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of PRIMARY_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      // Let the startup launch overlay settle and the page-shell lay out.
      await page.waitForTimeout(400);
      await expectNoHorizontalOverflow(page, `${vp.name} ${route}`);
      await testInfo.attach(`${vp.name}${route.replace(/\//g, "_") || "_home"}.png`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
  });
}

test("Small Display 480x640 profile supports core interactions without overflow", async ({ page }) => {
  const server = await createMockC64Server({});
  try {
    await seedUiMocks(page, server.baseUrl);
    await page.goto("/");
    await applyDisplayProfileViewport(page, "small");
    await expect(page.getByTestId("tab-home")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.displayProfile)).toBe("compact");
    await expect(page.getByText(/Auto currently resolves/i)).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "small home initial");

    const tabs = [
      { id: "tab-home", url: /\//, heading: "Home" },
      { id: "tab-play", url: /\/play/, heading: "Play Files" },
      { id: "tab-disks", url: /\/disks/, heading: "Disks" },
      { id: "tab-config", url: /\/config/, heading: "Config" },
      { id: "tab-settings", url: /\/settings/, heading: "Settings" },
      { id: "tab-docs", url: /\/docs/, heading: "Docs" },
    ] as const;

    for (const tab of tabs) {
      await page.getByTestId(tab.id).click();
      await expect(page).toHaveURL(tab.url);
      await expect(page.getByTestId("app-bar-title-zone").getByRole("heading", { name: tab.heading })).toBeVisible();
      await expectNoHorizontalOverflow(page, `small ${tab.id}`);
    }

    await page.getByTestId("tab-home").click();
    await page.getByTestId("home-system-info").click();
    await expect(page.getByTestId("home-system-git")).toBeVisible();
    const cpuSlider = page.getByTestId("home-cpu-speed-slider").getByRole("slider");
    await cpuSlider.focus();
    const before = await cpuSlider.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cpuSlider.getAttribute("aria-valuenow")).not.toBe(before);
    await expectNoHorizontalOverflow(page, "small home expanded system and slider");

    await page.getByTestId("tab-play").click();
    await page.getByRole("button", { name: /add items/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page, "small play add-items dialog");

    await page.getByTestId("tab-settings").click();
    const orientation = page.getByTestId("settings-screen-orientation-mode");
    await expect(orientation.getByRole("button", { name: "Portrait" })).toBeVisible();
    await orientation.getByRole("button", { name: "Auto" }).click();
    await expect(orientation.getByRole("button", { name: "Auto" })).toHaveClass(/bg-primary/);

    const host = page.getByTestId("settings-device-host");
    await host.fill("u64-480");
    await expect(host).toHaveValue("u64-480");

    await page.locator("#disk-autostart-mode").click();
    await page.getByRole("option", { name: /DMA/ }).click();
    await expect(page.locator("#disk-autostart-mode")).toContainText("DMA");
    await expectNoHorizontalOverflow(page, "small settings orientation field and select");
  } finally {
    await server.close();
  }
});
