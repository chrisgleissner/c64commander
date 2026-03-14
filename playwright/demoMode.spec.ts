/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import {
  allowWarnings,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from "./traceUtils";
import { enableGoldenTrace } from "./goldenTraceRegistry";
import { saveCoverageFromPage } from "./withCoverage";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  try {
    await attachStepScreenshot(page, testInfo, label);
  } catch (error) {
    console.warn(`Step screenshot failed for "${label}"`, error);
  }
};

const clickWithoutNavigationWait = async (page: Page, locator: Locator, attempts = 3) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await locator.click({ timeout: 10000, noWaitAfter: true });
      return;
    } catch (error) {
      if (attempt >= attempts - 1) {
        const handle = await locator.elementHandle().catch(() => null);
        if (handle) {
          try {
            await page.evaluate((node) => (node as HTMLElement).click(), handle);
            return;
          } catch {
            // Fall through and throw the original click error.
          }
        }
        throw error;
      }
      await page.waitForTimeout(250);
    }
  }
};

const dismissDemoModeDialogIfVisible = async (page: Page) => {
  const dialog = page.getByRole("dialog", { name: "Demo Mode" });
  if (!(await dialog.isVisible().catch(() => false))) return;
  const continueButton = dialog.getByRole("button", { name: /Continue in Demo Mode|Close|Dismiss|OK/i }).first();
  if (await continueButton.isVisible().catch(() => false)) {
    await clickWithoutNavigationWait(page, continueButton);
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(dialog).toBeHidden({ timeout: 5000 });
};

const seedRoutingExpectations = async (page: Page, realBaseUrl: string) => {
  await page.addInitScript(
    ({ realBaseUrl: realArg }: { realBaseUrl: string }) => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = realArg;
      (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = [realArg];
    },
    { realBaseUrl },
  );
};

const closeConnectionPopover = async (page: Page) => {
  const closeButton = page.getByTestId("connection-status-close");
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(page.getByTestId("connection-status-popover")).toBeHidden({
    timeout: 10000,
  });
};

test.describe("Automatic Demo Mode", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      if (!page.isClosed()) {
        await finalizeEvidence(page, testInfo);
      }
      await server?.close?.().catch(() => {});
    }
  });

  test("connectivity indicator is present on all main pages", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    const routes = ["/", "/play", "/disks", "/config", "/settings", "/docs"];
    for (const route of routes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const indicator = page.getByTestId("connectivity-indicator");
      await expect(indicator).toBeVisible();
      await expect(indicator).toHaveAttribute(
        "data-connection-state",
        /REAL_CONNECTED|DISCOVERING|UNKNOWN|DEMO_ACTIVE|OFFLINE_NO_DEMO/,
      );
    }

    await snap(page, testInfo, "indicator-on-all-pages");
  });

  test("real connection shows green C64U indicator", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED");
    await expect(indicator.locator(".indicator-real")).toHaveText("C64U");
    await snap(page, testInfo, "real-connected-indicator");
  });

  test("connection status surface covers checking, not yet connected, online, and offline states", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    server = await createMockC64Server({});

    await page.addInitScript(() => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:1";
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "0");
      localStorage.setItem("c64u_startup_discovery_window_ms", "2500");
      localStorage.setItem("c64u_discovery_probe_timeout_ms", "2000");
      localStorage.setItem("c64u_device_host", "127.0.0.1:1");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toBeVisible();
    await indicator.click();
    const popover = page.getByTestId("connection-status-popover");
    await expect(popover).toContainText(/Status: (Checking…|Not yet connected)/);

    await closeConnectionPopover(page);
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    await indicator.click();
    await expect(popover).toContainText("Status: Not yet connected");
    await expect(popover.getByRole("button", { name: "Retry Now" })).toBeVisible();

    await popover.getByRole("button", { name: "Change" }).click();
    await popover.getByLabel("C64U Hostname / IP").fill(new URL(server.baseUrl).host);
    await popover.getByRole("button", { name: "Save" }).click();

    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();
    await expect(popover).toContainText("Status: Online");
    await expect(popover.getByRole("button", { name: "Retry Now" })).toBeHidden();

    await popover.getByRole("button", { name: "Change" }).click();
    await popover.getByLabel("C64U Hostname / IP").fill("127.0.0.1:1");
    await popover.getByRole("button", { name: "Save" }).click();

    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    await indicator.click();
    await expect(popover).toContainText("Status: Offline");
    await expect(popover.getByRole("button", { name: "Retry Now" })).toBeVisible();
    await snap(page, testInfo, "connection-status-surface-states");
  });

  test("connection pop-up diagnostics rows are text-only and open deterministic diagnostics tabs", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await page.addInitScript(() => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:1";
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "0");
      localStorage.setItem("c64u_startup_discovery_window_ms", "1000");
      localStorage.setItem("c64u_discovery_probe_timeout_ms", "600");
      localStorage.setItem("c64u_device_host", "127.0.0.1:1");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });

    const openPopover = async () => {
      await indicator.click();
      const popover = page.getByTestId("connection-status-popover");
      await expect(popover.getByText("Diagnostics", { exact: true })).toBeVisible();
      return popover;
    };

    const closeDiagnosticsDialog = async () => {
      const dialog = page.getByRole("dialog", { name: "Diagnostics" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toBeHidden();
    };

    const popover = await openPopover();
    const restRow = popover.getByTestId("connection-diagnostics-row-rest");
    const ftpRow = popover.getByTestId("connection-diagnostics-row-ftp");
    const logIssuesRow = popover.getByTestId("connection-diagnostics-row-log-issues");

    await expect(popover).toContainText(/Last activity:\s+(\d+s ago|\d+m \d+s ago|none yet|unknown)/i);
    await expect(popover.getByRole("button", { name: "Change" })).toBeVisible();
    await expect(restRow).toContainText(/REST:\s+\d+\s+of\s+\d+\s+requests\s+failed/i);
    await expect(ftpRow).toContainText(/FTP:\s+\d+\s+of\s+\d+\s+operations\s+failed/i);
    await expect(logIssuesRow).toContainText(/Logs:\s+\d+\s+issues\s+in\s+\d+\s+logs/i);

    const popoverLocator = page.getByTestId("connection-status-popover");
    await restRow.click();
    await expect(page.getByRole("dialog", { name: "Diagnostics" })).toBeVisible();
    await expect(popoverLocator).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Actions" })).toHaveAttribute("aria-selected", "true");
    await closeDiagnosticsDialog();
    await expect(popoverLocator).toHaveCount(0);

    const popoverAfterRest = await openPopover();
    await popoverAfterRest.getByTestId("connection-diagnostics-row-ftp").click();
    await expect(page.getByRole("tab", { name: "Actions" })).toHaveAttribute("aria-selected", "true");
    await closeDiagnosticsDialog();

    const popoverAfterFtp = await openPopover();
    await popoverAfterFtp.getByTestId("connection-diagnostics-row-log-issues").click();
    await expect(page.getByRole("tab", { name: "Errors" })).toHaveAttribute("aria-selected", "true");
    await snap(page, testInfo, "connection-popover-diagnostics-navigation");
  });

  test("legacy base URL migrates to device host on startup", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    await page.addInitScript(
      ({ baseUrl }: { baseUrl: string }) => {
        localStorage.setItem("c64u_base_url", baseUrl);
        localStorage.removeItem("c64u_device_host");
      },
      { baseUrl: server.baseUrl },
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 5000 });

    const storedHost = await page.evaluate(() => localStorage.getItem("c64u_device_host"));
    expect(storedHost).toBe(new URL(server.baseUrl).host);
    const legacyBase = await page.evaluate(() => localStorage.getItem("c64u_base_url"));
    expect(legacyBase).toBeNull();

    await snap(page, testInfo, "legacy-base-url-migrated");
  });

  test("demo interstitial appears once per session and manual retry uses discovery", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    server = await createMockC64Server({});

    await page.addInitScript(() => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:1";
      (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = ["http://127.0.0.1:1"];
      localStorage.setItem("c64u_startup_discovery_window_ms", "600");
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
      localStorage.setItem("c64u_background_rediscovery_interval_ms", "5000");
      localStorage.setItem("c64u_device_host", "127.0.0.1:1");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
      sessionStorage.removeItem("c64u_demo_interstitial_shown");
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.getByTestId("connectivity-indicator");
    const dialog = page.getByRole("dialog", { name: "Demo Mode" });

    // Wait for DEMO_ACTIVE state first – Playwright's locator polling reliably
    // detects attribute changes on existing elements but is slow to observe new
    // Portal-rendered elements inserted into document.body during heavy initial
    // render cycles.
    await expect(indicator).toHaveAttribute("data-connection-state", "DEMO_ACTIVE", { timeout: 10000 });

    // Dialog must appear in a fresh session
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, "demo-interstitial-shown");

    // Dismiss it
    await dialog.getByRole("button", { name: "Continue in Demo Mode" }).click();
    await expect(dialog).toBeHidden();

    await expect(indicator).toHaveAttribute("data-connection-state", "DEMO_ACTIVE");
    await expect(indicator).toHaveAttribute("aria-label", /C64U( Demo)?/);
    await snap(page, testInfo, "demo-indicator");

    // Manual retry: should not show interstitial again in this session.
    await clickWithoutNavigationWait(page, indicator);
    await clickWithoutNavigationWait(page, page.getByRole("button", { name: "Retry Now" }));
    await expect(indicator).toHaveAttribute("data-connection-state", /DISCOVERING|DEMO_ACTIVE/);
    await expect(dialog).toBeHidden();
    await snap(page, testInfo, "no-repeat-interstitial");
  });

  test("settings-triggered rediscovery uses updated password for probes", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    const seenPasswords: string[] = [];
    await page.route("**/v1/info", async (route: Route) => {
      const req = route.request();
      const header = req.headers()["x-password"];
      if (typeof header === "string") {
        seenPasswords.push(header);
      }
      await route.continue();
    });

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const passwordInput = page.getByLabel(/password|network password/i);
    await passwordInput.fill("new-password");
    await page.getByRole("button", { name: /Save & Connect|Save connection/i }).click();

    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 5000 });
    expect(seenPasswords).toContain("new-password");
    await snap(page, testInfo, "settings-rediscovery-password");
  });

  test("demo mode does not overwrite stored base URL", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");

    await page.addInitScript(() => {
      const unreachableBaseUrl = "http://127.0.0.1:1";
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = unreachableBaseUrl;
      (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = [unreachableBaseUrl];
      localStorage.setItem("c64u_startup_discovery_window_ms", "1000");
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
      localStorage.setItem("c64u_device_host", "127.0.0.1:1");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
      sessionStorage.removeItem("c64u_demo_interstitial_shown");
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const indicator = page.getByTestId("connectivity-indicator");
    const dialog = page.getByRole("dialog", { name: "Demo Mode" });
    await expect(indicator).toHaveAttribute("data-connection-state", "DEMO_ACTIVE", { timeout: 10000 });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue in Demo Mode" }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const urlInput = page.locator("#deviceHost");
    await expect(urlInput).toHaveValue("127.0.0.1:1");

    const stored = await page.evaluate(() => localStorage.getItem("c64u_base_url"));
    expect(stored).toBeNull();
    await snap(page, testInfo, "demo-base-url-preserved");
  });

  test("save & connect exits demo mode when base URL is valid", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);

    await page.addInitScript(() => {
      localStorage.setItem("c64u_startup_discovery_window_ms", "3000");
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
      localStorage.setItem("c64u_device_host", "127.0.0.1:1");
      sessionStorage.removeItem("c64u_demo_interstitial_shown");
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog", { name: "Demo Mode" });
    const dialogVisible = await dialog.isVisible({ timeout: 5000 }).catch(() => false);
    if (dialogVisible) {
      await dialog.getByRole("button", { name: "Continue in Demo Mode" }).click();
    }
    const indicator = page.getByTestId("connectivity-indicator");
    await expect(indicator).toHaveAttribute("data-connection-state", /DEMO_ACTIVE|DISCOVERING/);

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await dismissDemoModeDialogIfVisible(page);
    const urlInput = page.locator("#deviceHost");
    const host = new URL(server.baseUrl).host;
    await urlInput.fill(host);
    await clearTraces(page);
    let saveButton = page.getByRole("button", {
      name: /Save & Connect|Save connection/i,
    });
    if (!(await saveButton.isVisible().catch(() => false))) {
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await dismissDemoModeDialogIfVisible(page);
      saveButton = page.getByRole("button", {
        name: /Save & Connect|Save connection/i,
      });
    }
    await expect(saveButton).toBeVisible({ timeout: 15000 });
    await clickWithoutNavigationWait(page, saveButton);

    await expect.poll(() => server.requests.some((req) => req.url.startsWith("/v1/info"))).toBe(true);
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 15000 });
    const stored = await page.evaluate(() => localStorage.getItem("c64u_device_host"));
    expect(stored).toBe(new URL(server.baseUrl).host);
    await expectRestTraceSequence(page, testInfo, "/v1/info");
    await snap(page, testInfo, "demo-exit-connected");
  });
});
