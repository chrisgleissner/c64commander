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
      await server?.close?.().catch(() => {});
    }
  });

  test("Connection Status dialog content regression: has Last request with numeric format", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    await indicator.click();

    const dialog = page.getByTestId("connection-status-popover");
    await expect(dialog).toBeVisible();
    // Ensures the time is shown in numeric format (e.g. "5s ago", "2m 3s ago") rather than
    // text like "just now" that was removed in a previous fix.
    await expect(dialog).toContainText(/Last request:\s+(\d+s ago|\d+m \d+s ago|none yet|unknown)/i);
    await expect(dialog).not.toContainText("just now");
    await expect(dialog).not.toContainText("Communication");
  });

  test("Connection Status dialog close button has unified ModalCloseButton classes", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    await indicator.click();

    const dialog = page.getByTestId("connection-status-popover");
    await expect(dialog).toBeVisible();

    const closeBtn = page.getByTestId("connection-status-close");
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

    // Open connection status and navigate to diagnostics via the diagnostics section.
    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();
    const connDialog = page.getByTestId("connection-status-popover");
    await expect(connDialog).toBeVisible();

    // Click the REST diagnostics row to open the Diagnostics overlay.
    await connDialog.getByTestId("connection-diagnostics-row-rest").click();

    const diagDialog = page.getByRole("dialog", { name: "Diagnostics" });
    await expect(diagDialog).toBeVisible({ timeout: 5000 });

    const closeBtn = diagDialog.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    const classAttr = (await closeBtn.getAttribute("class")) ?? "";
    for (const cls of MODAL_CLOSE_CLASSES) {
      expect(classAttr, `diagnostics close button should have class: ${cls}`).toContain(cls);
    }
  });
});
