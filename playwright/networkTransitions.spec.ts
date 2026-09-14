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
import {
  assertNoUiIssues,
  attachStepScreenshotTolerant,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const snap = attachStepScreenshotTolerant;

/*
 * Leaving home and coming back, as the page sees it: the browser goes offline and online again. The
 * app has to show the device offline calmly (no problem count, no error toast, no warnings) and
 * reconnect by itself as soon as the network is back, without a tap.
 */
test.describe("Network transitions", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      if (!page.isClosed()) {
        await finalizeEvidence(page, testInfo);
      }
      await server?.close?.().catch((error) => {
        console.warn("Failed to close mock server", error);
      });
    }
  });

  test("goes offline quietly when the network drops and reconnects by itself when it returns", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);

    server = await createMockC64Server({});
    const host = new URL(server.baseUrl).host;
    await page.addInitScript(
      ({ baseUrl, host: hostArg }: { baseUrl: string; host: string }) => {
        const win = window as Window & {
          __c64uExpectedBaseUrl?: string;
          __c64uTestProbeEnabled?: boolean;
          __c64uAllowedBaseUrls?: string[];
        };
        win.__c64uExpectedBaseUrl = baseUrl;
        win.__c64uTestProbeEnabled = true;
        win.__c64uAllowedBaseUrls = [baseUrl];
        localStorage.setItem("c64u_device_host", hostArg);
        localStorage.removeItem("c64u_password");
        localStorage.removeItem("c64u_has_password");
      },
      { baseUrl: server.baseUrl, host },
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(badge).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    // Home's first reads finish before the network goes, so any request that fails below was made offline.
    await page.waitForLoadState("networkidle");

    const failedWhileOffline: string[] = [];
    page.on("requestfailed", (request) => failedWhileOffline.push(request.url()));
    await page.context().setOffline(true);

    // Driven by the offline event itself: a device probe timing out would take several seconds.
    await expect(badge).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 1500 });
    // Long enough for the Home page's device polls to have come due while offline.
    await page.waitForTimeout(3000);
    await expect(badge).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO");
    await expect(badge).not.toHaveAttribute("aria-label", /problem/i);
    await expect(badge).not.toHaveText(/\d/);
    await expect(page.locator('[data-state="open"].destructive')).toHaveCount(0);
    expect(failedWhileOffline).toEqual([]);
    await snap(page, testInfo, "offline-calm");

    const requestsBeforeReturn = server.requests.length;
    const returnedAt = Date.now();
    await page.context().setOffline(false);

    await expect(badge).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 4000 });
    // The background schedule would wait for its next tick; the network event reconnects at once.
    expect(Date.now() - returnedAt).toBeLessThan(4000);
    expect(server.requests.length).toBeGreaterThan(requestsBeforeReturn);
    await expect(page.locator('[data-state="open"].destructive')).toHaveCount(0);
    await snap(page, testInfo, "reconnected");
  });
});
