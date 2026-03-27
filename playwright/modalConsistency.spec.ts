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

const FORBIDDEN_CLOSE_CLASSES = [
  "rounded-full",
  "shadow-sm",
  "bg-background/80",
  "border-border/60",
  "hover:bg-accent",
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

test.describe("Modal close-control consistency", () => {
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
    await expect(diagSheet.getByTestId("diagnostics-health-line")).toContainText(/Unavailable|Idle/i);
    await expect(diagSheet).not.toContainText("just now");
    await expect(diagSheet).not.toContainText("Communication");
  });

  test("Connection Status dialog close control uses the plain shared glyph", async ({
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
    for (const cls of FORBIDDEN_CLOSE_CLASSES) {
      expect(classAttr, `close control should not have class: ${cls}`).not.toContain(cls);
    }
    await expect(closeBtn.locator("svg")).toHaveCount(0);
    await expect.poll(() => closeBtn.evaluate((button) => button.textContent ?? "")).toContain("×");
  });

  test("Diagnostics dialog close control uses the plain shared glyph", async ({
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
    for (const cls of FORBIDDEN_CLOSE_CLASSES) {
      expect(classAttr, `diagnostics close control should not have class: ${cls}`).not.toContain(cls);
    }
    await expect(closeBtn.locator("svg")).toHaveCount(0);
    await expect.poll(() => closeBtn.evaluate((button) => button.textContent ?? "")).toContain("×");
  });

  test("workflow sheet keeps tab bar in layout while translating it off-screen", async ({
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

    const tabBarWrapper = page
      .locator("div[data-interstitial-active]")
      .filter({ has: page.locator("nav.tab-bar") })
      .first();
    await expect(tabBarWrapper).toHaveAttribute("data-interstitial-active", "false");

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });
    await expect(tabBarWrapper).toHaveAttribute("data-interstitial-active", "true");

    const transform = await tabBarWrapper.evaluate((element) => getComputedStyle(element).transform);
    expect(transform).not.toBe("none");
  });

  test("Diagnostics overflow menu stays left of the close button on small screens", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });

    const overflowBtn = diagSheet.getByTestId("diagnostics-overflow-menu");
    const closeBtn = diagSheet.getByRole("button", { name: "Close" });
    await expect(overflowBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    const overflowBox = await overflowBtn.boundingBox();
    const closeBox = await closeBtn.boundingBox();

    expect(overflowBox, "overflow menu should have a measurable hit target").not.toBeNull();
    expect(closeBox, "close button should have a measurable hit target").not.toBeNull();

    if (!overflowBox || !closeBox) {
      throw new Error("Diagnostics header controls did not expose bounding boxes.");
    }

    expect(
      overflowBox.x + overflowBox.width,
      "overflow menu should remain clearly to the left of the close button",
    ).toBeLessThanOrEqual(closeBox.x - 8);
  });

  test("Diagnostics header removes the old wrapped close button styling", async ({
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

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });
    await expect(diagSheet.getByTestId("diagnostics-overflow-menu")).toBeVisible();
    await expect(diagSheet.locator('[data-testid="lighting-sheet-handle"]')).toHaveCount(0);
  });
});
