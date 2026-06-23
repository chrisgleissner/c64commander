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
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { enableTraceAssertions } from "./traceUtils";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe("Demo config from YAML", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test("config page shows the C64U menu hierarchy with the junk drawer dissolved", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/config");
    await snap(page, testInfo, "config-open");

    // The C64U device (mock /v1/info reports "C64 Ultimate") renders the menu-aligned
    // hierarchy: settings live under friendly menu pages, not raw REST categories.
    await expect(page.getByTestId("config-menu-page-video-setup")).toBeVisible();
    await expect(page.getByTestId("config-menu-page-turbo-boost")).toBeVisible();
    await expect(page.getByTestId("config-menu-page-network-services-&-timezone")).toBeVisible();
    // The Audio Mixer page keeps its specialized renderer (header "Audio mixer").
    await expect(page.getByRole("button", { name: "Audio mixer" })).toBeVisible();
    // Smart routing places every REST-only leftover on an aligned page, so the residual
    // Advanced (REST-only) junk drawer is dissolved entirely.
    await expect(page.getByTestId("config-advanced-fallback")).toHaveCount(0);
    await snap(page, testInfo, "menu-hierarchy-visible");
  });
});
