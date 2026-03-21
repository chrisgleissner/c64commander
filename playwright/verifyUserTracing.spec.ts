/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";

test.afterEach(async ({ page }, testInfo) => {
  await saveCoverageFromPage(page, testInfo.title);
});

test("verify comprehensive user tracing", async ({ page }) => {
  const waitForBackdropToClear = async () => {
    const backdrop = page.locator('div[data-state="open"][aria-hidden="true"][data-aria-hidden="true"]').last();
    if (await backdrop.isVisible().catch(() => false)) {
      await expect(backdrop).toBeHidden({ timeout: 10000 });
    }
  };

  const dismissBlockingDialogIfPresent = async () => {
    const continueInDemoMode = page.getByRole("button", { name: /continue in demo mode/i }).first();
    if (await continueInDemoMode.isVisible().catch(() => false)) {
      await continueInDemoMode.click();
      await waitForBackdropToClear();
      return;
    }

    const closeButton = page
      .getByRole("dialog")
      .getByRole("button", { name: /close|dismiss|ok|cancel/i })
      .first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
      await waitForBackdropToClear();
    }
  };

  const clickWithRetry = async (locator: ReturnType<typeof page.locator>, label: string) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await dismissBlockingDialogIfPresent();
      await waitForBackdropToClear();
      const target = locator.first();
      await expect(target).toBeVisible();
      await target.scrollIntoViewIfNeeded();
      try {
        await target.click({ timeout: 10000 });
        return;
      } catch (error) {
        if (attempt === 0) {
          console.warn(`${label} click blocked; retrying after dismissing overlays.`, error);
          continue;
        }
        throw error;
      }
    }
  };

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Wait for tracing bridge
  await page.waitForFunction(() => (window as any).__c64uTracing);

  const dismissDemoInterstitialIfPresent = dismissBlockingDialogIfPresent;

  // Handle discovery dialog if it appears (can show after initial load)
  await dismissDemoInterstitialIfPresent();

  // Clear traces first
  await page.evaluate(() => (window as any).__c64uTracing?.clearTraces());

  // 1. Navigate via tab bar to Disks
  await dismissDemoInterstitialIfPresent();
  await clickWithRetry(page.getByTestId("tab-disks"), "Disks tab");
  await page.waitForURL("**/disks");

  // 2. Click Tab Bar "Config" (TabBar)
  await dismissDemoInterstitialIfPresent();
  await clickWithRetry(page.getByTestId("tab-config"), "Config tab");
  await page.waitForURL("**/config");
  await dismissDemoInterstitialIfPresent();
  await waitForBackdropToClear();

  // 3. Open diagnostics from header indicator
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await dismissBlockingDialogIfPresent();
    const connectivityIndicator = page.locator('[data-slot-active="true"]').getByTestId("unified-health-badge");
    await expect(connectivityIndicator).toBeVisible();
    try {
      await connectivityIndicator.click({ timeout: 10000 });
      break;
    } catch (error) {
      if (attempt === 0) {
        console.warn("Connectivity indicator click blocked; retrying after dismissing overlays.", error);
        continue;
      }
      throw error;
    }
  }

  // Get traces
  const traces: any[] = await page.evaluate(() => (window as any).__c64uTracing?.getTraces());

  console.log("Total traces:", traces?.length);
  const userActions = traces.filter((t: any) => t.origin === "user" && t.type === "action-start");

  console.log("Captured User Actions:");
  userActions.forEach((t) => console.log(`- ${t.data?.name}`));

  const disksTabClick = userActions.find((t: any) => t.data?.component === "Tab" && t.data?.name.includes("Disks"));
  expect(disksTabClick).toBeDefined();
  expect(disksTabClick.data.component).toBe("Tab");

  const configTabClick = userActions.find((t: any) => t.data?.name.includes("Config") && t.data?.component === "Tab");
  expect(configTabClick).toBeDefined();
  expect(configTabClick.data.component).toBe("Tab");

  const connectivityClick = userActions.find(
    (t: any) =>
      t.data?.component === "GlobalInteraction" &&
      typeof t.data?.name === "string" &&
      /click .*(c64u|demo mode|system unhealthy)/i.test(t.data.name),
  );
  expect(connectivityClick).toBeDefined();
  expect(connectivityClick.data.component).toBe("GlobalInteraction");
});
