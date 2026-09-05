/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { clickSourceSelectionButton } from "./sourceSelection";
import { auditCompactSurface, formatDefects, type SurfaceKind } from "./compactUsabilityAudit";

/**
 * Whether each dialog and sheet is usable on the smallest screen the app supports.
 *
 * `smallScreenLayoutIntegrity.spec.ts` and `callbackSmallScreen.spec.ts` already prove that
 * nothing is clipped and that text fits. Both passed while the Add items browser was showing one
 * row of a file list on a 320x427 panel, because a surface that spends four fifths of the screen
 * on its own chrome is not clipping anything. This spec measures what is left for the content.
 *
 * The viewport is the smallest supported panel: 480x640 at device pixel ratio 1.5 gives the page
 * 320x427 CSS px. `deviceScaleFactor` is set to match, though only the CSS size affects layout.
 */

test.use({ viewport: { width: 320, height: 427 }, deviceScaleFactor: 1.5 });

const COMPACT_PROFILE = "compact";

/** Opens the app at `route` on the compact profile, with the fake device already reachable. */
const openCompact = async (page: Page, route: string) => {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.displayProfile === expected,
    COMPACT_PROFILE,
  );
  await page.waitForTimeout(400);
};

/**
 * Measures the surface and fails with every defect listed at once. Reporting one defect per run
 * would mean one build per defect on a surface that has several.
 */
const expectUsable = async (page: Page, name: string, selector: string, kind: SurfaceKind) => {
  const measurement = await auditCompactSurface(page, selector, kind);
  expect(measurement.defects, formatDefects(name, measurement)).toEqual([]);
  return measurement;
};

const openDialog = (page: Page): Locator => page.locator('[role="dialog"][data-state="open"]').last();

test.describe("Every surface is usable on a 320x427 panel", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
    });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("the Add items browser leaves room for the file list", async ({ page }) => {
    await openCompact(page, "/play");

    await page.getByRole("button", { name: /Add items|Add more items/i }).click();
    await expect(openDialog(page)).toBeVisible();

    await expectUsable(page, "Add items source interstitial", '[role="dialog"][data-state="open"]', "form");

    await clickSourceSelectionButton(page, "C64U");
    await expect(page.getByTestId("c64u-file-picker")).toBeVisible({ timeout: 15_000 });

    await expectUsable(page, "Add items browser (C64U)", '[data-app-surface="sheet"]', "list");
  });

  test("the primary pages leave room for their own content", async ({ page }) => {
    for (const route of ["/", "/play", "/disks", "/config", "/settings", "/docs"]) {
      await openCompact(page, route);
      const measurement = await auditCompactSurface(page, "main", "form");
      const structural = measurement.defects.filter(
        (defect) => defect.kind === "horizontal-overflow" || defect.kind === "clipped-content",
      );
      expect(structural, formatDefects(`page ${route}`, measurement)).toEqual([]);
    }
  });
});
