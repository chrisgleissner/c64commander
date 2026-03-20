/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { allowWarnings, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const MODAL_CLOSE_CLASSES = [
  "opacity-70",
  "hover:opacity-100",
  "rounded-sm",
  "ring-offset-background",
  "focus:ring-2",
  "focus:ring-ring",
];

const seedOfflineState = async (page: Page) => {
  await page.addInitScript(() => {
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:1";
    localStorage.setItem("c64u_automatic_demo_mode_enabled", "0");
    localStorage.setItem("c64u_startup_discovery_window_ms", "1000");
    localStorage.setItem("c64u_discovery_probe_timeout_ms", "600");
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_password");
    localStorage.removeItem("c64u_has_password");
  });
};

test.describe("Modal close-button consistency", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server?.close?.().catch(() => { });
    }
  });

  test("Connection Status dialog content regression: has Last activity with numeric format", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    // UnifiedHealthBadge now opens the Diagnostics sheet directly instead of a connection-status popover.
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible();
    await expect(diagSheet).toContainText("Device not reachable");
    await expect(diagSheet).toContainText("Cannot reach this device right now.");
    await expect(diagSheet).not.toContainText("just now");
    await expect(diagSheet).not.toContainText("Communication");
  });

  test("Connection Status dialog close button has unified ModalCloseButton classes", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    // UnifiedHealthBadge now opens the Diagnostics sheet directly instead of a connection-status popover.
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible();

    const closeBtn = diagSheet.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    const classAttr = (await closeBtn.getAttribute("class")) ?? "";
    for (const cls of MODAL_CLOSE_CLASSES) {
      expect(classAttr, `close button should have class: ${cls}`).toContain(cls);
    }
  });

  test("Diagnostics dialog close button has unified ModalCloseButton classes", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // UnifiedHealthBadge now opens the Diagnostics sheet directly — no intermediate popover.
    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });

    const closeBtn = diagSheet.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    const classAttr = (await closeBtn.getAttribute("class")) ?? "";
    for (const cls of MODAL_CLOSE_CLASSES) {
      expect(classAttr, `diagnostics close button should have class: ${cls}`).toContain(cls);
    }
  });
});
