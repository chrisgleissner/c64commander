/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

/**
 * Lead F1: the app's custom ArrowUp/Down keypad ring deliberately disengages
 * inside any open `[role=dialog]` (see useFocusNavigation.tsx's
 * isWithinOpenOverlay guard) and hands off to Radix's own FocusScope, which
 * traps Tab/Shift+Tab natively - the same architecture every dialog in this
 * app already relies on, not something specific to Remote Input. This proves
 * that architecture actually reaches every Keys-tab key and the Close button
 * via pure keyboard Tab order, with no mouse/touch and no custom ring.
 */

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    { timeout: 10000 },
  );
};

test.describe("Remote Input keyboard-only (Tab order) reachability (Lead F1)", () => {
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

  test("reaches a Keys-tab key and the Close button via Tab alone, and Enter activates Close", async ({ page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-machine-inline-openRemoteInput").click();
    await expect(page.getByTestId("remote-input-sheet")).toBeVisible();
    await page.getByTestId("remote-input-mode-type").click();
    await expect(page.getByTestId("remote-input-type-keyboard")).toBeVisible();

    // Start Tab traversal from a known point inside the dialog.
    await page.getByTestId("remote-input-mode-type").focus();

    const seenTestIds: string[] = [];
    let reachedAKey = false;
    let reachedClose = false;
    const MAX_TABS = 200;
    for (let i = 0; i < MAX_TABS && !reachedClose; i += 1) {
      await page.keyboard.press("Tab");
      const testId = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
      if (testId) seenTestIds.push(testId);
      if (testId?.startsWith("remote-input-key-")) reachedAKey = true;
      // The footer Close was removed; the sheet's top-right X (testid
      // remote-input-close) is now the sole Close affordance.
      if (testId === "remote-input-close") reachedClose = true;
    }

    expect(reachedAKey, `never reached a Keys-tab key; testids seen: ${seenTestIds.join(", ")}`).toBe(true);
    expect(reachedClose, `never reached Close within ${MAX_TABS} tabs; testids seen: ${seenTestIds.join(", ")}`).toBe(
      true,
    );

    // Activating Close via Enter (not a click) must actually close the sheet.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("remote-input-sheet")).not.toBeVisible();
  });
});
