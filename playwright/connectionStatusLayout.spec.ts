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
import {
  allowWarnings,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  try {
    await attachStepScreenshot(page, testInfo, label);
  } catch (error) {
    console.warn(`Step screenshot failed for "${label}"`, error);
  }
};

test.describe("Connection Status diagnostics layout", () => {
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

  const openDiagnostics = async (page: Page) => {
    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();
    const dialog = page.getByRole("dialog", { name: "Diagnostics" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("health-summary")).toBeVisible();
    return dialog;
  };

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

  test("health summary keeps REST and FTP activity rows aligned", async ({
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
    const dialog = await openDiagnostics(page);
    const restRow = dialog.getByText(/^REST:/).first();
    const ftpRow = dialog.getByText(/^FTP:/).first();

    const restBox = await restRow.boundingBox();
    const ftpBox = await ftpRow.boundingBox();

    expect(restBox).toBeTruthy();
    expect(ftpBox).toBeTruthy();
    expect(Math.abs((restBox?.x ?? 0) - (ftpBox?.x ?? 0))).toBeLessThanOrEqual(4);
    expect(Math.abs((restBox?.height ?? 0) - (ftpBox?.height ?? 0))).toBeLessThanOrEqual(4);

    await snap(page, testInfo, "connection-status-layout-rhythm");
  });

  test("overall health row and device detail shortcut stay focusable and compact", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
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
    const dialog = await openDiagnostics(page);

    const overallHealthRow = dialog.getByTestId("overall-health-row");
    const deviceDetailButton = dialog.getByTestId("open-device-detail");

    await expect(overallHealthRow).toBeVisible();
    await expect(deviceDetailButton).toBeVisible();

    const tagName = await deviceDetailButton.evaluate((element) => element.tagName.toLowerCase());
    expect(tagName).toBe("button");

    await deviceDetailButton.focus();
    const focused = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    expect(focused).toBe("button");

    const summaryBox = await overallHealthRow.boundingBox();
    const detailBox = await deviceDetailButton.boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    expect(Math.abs((summaryBox?.y ?? 0) - (detailBox?.y ?? 0))).toBeLessThanOrEqual(6);
  });

  test("contributor rows are flush-left aligned", async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const dialog = await openDiagnostics(page);

    const appRow = await dialog.getByTestId("contributor-row-app").boundingBox();
    const restRow = await dialog.getByTestId("contributor-row-rest").boundingBox();
    const ftpRow = await dialog.getByTestId("contributor-row-ftp").boundingBox();

    expect(appRow).not.toBeNull();
    expect(restRow).not.toBeNull();
    expect(ftpRow).not.toBeNull();
    expect(Math.abs((appRow?.x ?? 0) - (restRow?.x ?? 0))).toBeLessThanOrEqual(5);
    expect(Math.abs((appRow?.x ?? 0) - (ftpRow?.x ?? 0))).toBeLessThanOrEqual(5);
  });

  test("offline summary uses deterministic last-activity copy", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    await indicator.click();
    const dialog = page.getByRole("dialog", { name: "Diagnostics" });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByTestId("health-summary")).toContainText(
      /REST:\s+(No REST activity yet|.+\s+·\s+.+\s+·\s+(\d+s ago|\d+m \d+s ago))/i,
    );
    await expect(dialog.getByTestId("health-summary")).toContainText(
      /FTP:\s+(No FTP activity yet|.+\s+·\s+.+\s+·\s+(\d+s ago|\d+m \d+s ago))/i,
    );
    await expect(dialog.getByTestId("health-summary")).not.toContainText("just now");
    await expect(dialog.getByTestId("health-summary")).not.toContainText("Communication");
  });

  test("close button closes the diagnostics dialog", async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const dialog = await openDiagnostics(page);

    const closeButton = page.getByRole("button", { name: "Close" }).last();
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(dialog).toBeHidden();
  });

  test("Escape key closes the diagnostics dialog", async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const dialog = await openDiagnostics(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("clicking outside closes the diagnostics dialog", async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const dialog = await openDiagnostics(page);
    await page.mouse.click(10, 10);
    await expect(dialog).toBeHidden();
  });
});
