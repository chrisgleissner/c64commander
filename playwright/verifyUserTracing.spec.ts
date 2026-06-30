/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator } from "@playwright/test";
import { dismissStartupDiscoveryDialog } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";

test.afterEach(async ({ page }, testInfo) => {
  await saveCoverageFromPage(page, testInfo.title);
});

test("verify comprehensive user tracing", async ({ page }) => {
  const isLocatorVisible = async (locator: Locator, label: string) => {
    try {
      return await locator.isVisible();
    } catch (error) {
      console.warn(`Unable to inspect ${label}.`, error);
      return false;
    }
  };

  const waitForBackdropToClear = async () => {
    const backdrop = page.locator('div[data-state="open"][aria-hidden="true"][data-aria-hidden="true"]').last();
    if (await isLocatorVisible(backdrop, "open modal backdrop")) {
      await page.keyboard.press("Escape");
      await expect(backdrop).toBeHidden({ timeout: 10000 });
    }
  };

  const dismissBlockingDialogIfPresent = async () => {
    if (await dismissStartupDiscoveryDialog(page)) {
      await waitForBackdropToClear();
      return;
    }

    const continueInDemoMode = page.getByRole("button", { name: /continue in demo mode/i }).first();
    if (await isLocatorVisible(continueInDemoMode, "demo mode continue button")) {
      await continueInDemoMode.click();
      await waitForBackdropToClear();
      return;
    }

    const closeButton = page
      .getByRole("dialog")
      .getByRole("button", { name: /close|dismiss|ok|cancel/i })
      .first();
    if (await isLocatorVisible(closeButton, "generic dialog close button")) {
      try {
        await closeButton.click({ timeout: 5000, noWaitAfter: true });
      } catch (error) {
        console.warn("Generic dialog close button changed while being dismissed.", error);
        if (!(await isLocatorVisible(page.getByRole("dialog").first(), "generic dialog after close failure"))) {
          return;
        }
        await page.keyboard.press("Escape");
      }
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
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForFunction(() =>
    (window as any).__c64uTracing
      ?.getTraces()
      ?.some(
        (trace: any) =>
          trace?.origin === "user" &&
          trace?.type === "action-start" &&
          trace?.data?.component === "GlobalDiagnosticsOverlay" &&
          trace?.data?.name === "diagnostics.open",
      ),
  );

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

  const diagnosticsOpen = userActions.find(
    (t: any) => t.data?.component === "GlobalDiagnosticsOverlay" && t.data?.name === "diagnostics.open",
  );
  expect(diagnosticsOpen).toBeDefined();
  expect(diagnosticsOpen.data.component).toBe("GlobalDiagnosticsOverlay");
});
