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
import { seedUiMocks, uiFixtures } from "./uiMocks";
import {
  allowWarnings,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { clearTraces, enableTraceAssertions } from "./traceUtils";
import { enableGoldenTrace } from "./goldenTraceRegistry";
import { saveCoverageFromPage } from "./withCoverage";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const seedConfigVisibilityMocks = async (page: Page, serverBaseUrl: string, demoBaseUrl: string) => {
  await seedUiMocks(page, serverBaseUrl);

  const host = new URL(serverBaseUrl).host;
  await page.addInitScript(
    ({
      host: hostArg,
      demoBaseUrl: demoBaseUrlArg,
      serverBaseUrl: serverBaseUrlArg,
      snapshot,
    }: {
      host: string;
      demoBaseUrl: string;
      serverBaseUrl: string;
      snapshot: unknown;
    }) => {
      const routingWindow = window as Window & {
        __c64uAllowedBaseUrls?: string[];
        __c64uExpectedBaseUrl?: string;
        __c64uMockServerBaseUrl?: string;
        __c64uSecureStorageOverride?: unknown;
        __c64uTestProbeEnabled?: boolean;
      };
      const allowedBaseUrls = new Set<string>(routingWindow.__c64uAllowedBaseUrls ?? []);
      allowedBaseUrls.add(serverBaseUrlArg);
      allowedBaseUrls.add(demoBaseUrlArg);
      routingWindow.__c64uAllowedBaseUrls = Array.from(allowedBaseUrls);
      routingWindow.__c64uExpectedBaseUrl = serverBaseUrlArg;
      routingWindow.__c64uMockServerBaseUrl = demoBaseUrlArg;
      routingWindow.__c64uTestProbeEnabled = true;

      localStorage.setItem("c64u_startup_discovery_window_ms", "300");
      localStorage.setItem("c64u_automatic_demo_mode_enabled", "1");
      localStorage.setItem("c64u_feature_flag:demo_mode_enabled", "1");
      localStorage.setItem("c64u_device_host", hostArg);
      localStorage.setItem("c64u_base_url", serverBaseUrlArg);
      localStorage.removeItem("c64u_password");
      localStorage.removeItem("c64u_has_password");
      delete routingWindow.__c64uSecureStorageOverride;
      localStorage.setItem(`c64u_initial_snapshot:${serverBaseUrlArg}`, JSON.stringify(snapshot));
      sessionStorage.setItem(`c64u_initial_snapshot_session:${serverBaseUrlArg}`, "1");
      localStorage.setItem(`c64u_initial_snapshot:${demoBaseUrlArg}`, JSON.stringify(snapshot));
      sessionStorage.setItem(`c64u_initial_snapshot_session:${demoBaseUrlArg}`, "1");
      sessionStorage.setItem("c64u_demo_interstitial_shown", "1");
    },
    {
      host,
      demoBaseUrl,
      serverBaseUrl,
      snapshot: uiFixtures.initialSnapshot,
    },
  );
};

test.describe("Config visibility across modes", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let demoServer: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await demoServer?.close?.().catch((error) => {
        console.warn("Failed to close demo mock server", error);
      });
      await server?.close?.().catch((error) => {
        console.warn("Failed to close primary mock server", error);
      });
    }
  });

  test("config categories and values render in demo mode", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");

    server = await createMockC64Server(uiFixtures.configState);
    demoServer = await createMockC64Server(uiFixtures.configState);
    server.setReachable(false);
    await seedConfigVisibilityMocks(page, server.baseUrl, demoServer.baseUrl);

    await page.goto("/config", { waitUntil: "domcontentloaded" });
    const demoButton = page.getByRole("button", {
      name: "Continue in Demo Mode",
    });
    if (await demoButton.isVisible().catch(() => false)) {
      await demoButton.click();
    }
    await expect(page.getByRole("dialog", { name: "Demo Mode" })).toBeHidden();
    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute("data-connection-state", /DEMO_ACTIVE|REAL_CONNECTED/, { timeout: 10000 });
    await expect(indicator).toHaveAttribute("aria-label", /(Connected to .*|Demo mode)/);

    await expect(page.getByText("Not connected", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Audio Mixer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "U64 Specific Settings" })).toBeVisible();
    await expect(page.locator('[data-testid^="config-category-"]').first()).toBeVisible();

    await clearTraces(page);
    await snap(page, testInfo, "demo-connected-config");
  });

  test("config remains visible after switching demo → real", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");

    server = await createMockC64Server(uiFixtures.configState);
    demoServer = await createMockC64Server(uiFixtures.configState);
    server.setReachable(false);
    await seedConfigVisibilityMocks(page, server.baseUrl, demoServer.baseUrl);

    await page.goto("/config", { waitUntil: "domcontentloaded" });
    const demoButton = page.getByRole("button", {
      name: "Continue in Demo Mode",
    });
    if (await demoButton.isVisible().catch(() => false)) {
      await demoButton.click();
    }
    await expect(page.getByRole("dialog", { name: "Demo Mode" })).toBeHidden();
    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute("data-connection-state", /DEMO_ACTIVE|REAL_CONNECTED/, { timeout: 10000 });
    await expect(page.getByText("Not connected", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Audio Mixer" })).toBeVisible();

    server.setReachable(true);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Save & Connect|Save connection/i }).click();

    await page.goto("/config", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Audio Mixer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "U64 Specific Settings" })).toBeVisible();

    await page.getByRole("button", { name: "U64 Specific Settings" }).click();
    await clearTraces(page);

    const selectTrigger = page.getByLabel("System Mode select");
    await selectTrigger.click();
    await page.getByRole("option", { name: /^NTSC$/ }).click();

    await expect.poll(() => server.getState()["U64 Specific Settings"]["System Mode"].value).toBe("NTSC");

    await snap(page, testInfo, "config-visible-after-real");
  });
});
