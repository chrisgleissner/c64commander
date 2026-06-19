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
