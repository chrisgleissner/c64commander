/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test as base, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { allowWarnings, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

type Fixtures = {
  server: Awaited<ReturnType<typeof createMockC64Server>>;
};

const test = base.extend<Fixtures>({
  server: [
    async ({ page }, runFixture) => {
      const server = await createMockC64Server();
      await seedUiMocks(page, server.baseUrl, { clearStorageBeforeSeeding: true });
      try {
        await runFixture(server);
      } finally {
        await server.close();
      }
    },
    { auto: true },
  ],
});

const SID_SOCKETS_ROUTE = "**/v1/configs/SID%20Sockets%20Configuration**";

const failWith500 = (route: { fulfill: (options: Record<string, unknown>) => Promise<void> }) =>
  route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ errors: ["device busy"] }) });

const openAudio = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    { timeout: 10000 },
  );
  const toggle = page.getByTestId("home-section-toggle-audio");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
  }
};

const visibleSelectTriggersAreFilled = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="home-sid-shaping-socket"]')).every(
      (el) => (el.textContent ?? "").trim().length > 0,
    ),
  );

test.describe("Home audio read recovery", () => {
  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, "Expected failed SID Sockets Configuration reads.");
    await startStrictUiMonitoring(page, testInfo);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
    }
  });

  test("retries a failed first SID Sockets read and never shows an empty select", async ({ page }) => {
    let failuresLeft = 1;
    await page.route(SID_SOCKETS_ROUTE, (route) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return failWith500(route);
      }
      return route.fallback();
    });

    await page.goto("/");
    await openAudio(page);

    await expect(page.getByTestId("home-sid-entry-socket1")).toBeVisible({ timeout: 30000 });

    await expect(page.getByTestId("home-sid-loading")).toHaveCount(0);
    expect(await visibleSelectTriggersAreFilled(page)).toBe(true);
  });

  test("offers Retry while the read keeps failing and fills the selects once it succeeds", async ({ page }) => {
    let failing = true;
    await page.route(SID_SOCKETS_ROUTE, (route) => (failing ? failWith500(route) : route.fallback()));

    await page.goto("/");
    await openAudio(page);

    await expect(page.getByTestId("home-sid-read-error")).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId("home-sid-entry-socket1")).toHaveCount(0);

    failing = false;
    await page.getByTestId("home-sid-read-retry").click();

    await expect(page.getByTestId("home-sid-entry-socket1")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("home-sid-read-error")).toHaveCount(0);
    expect(await visibleSelectTriggersAreFilled(page)).toBe(true);
  });
});
