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

/**
 * Wait for the connection to settle before asserting on anything the device supplies.
 *
 * This spec used to assert straight after `goto("/config")`, which races the connection handoff: the
 * config tree is only rendered from the mock's `/v1/info` once that has landed, so under CI load
 * (instrumented bundle, four workers) the menu-page testids could be looked for before they could
 * possibly exist. It failed intermittently on main and passed in isolation — the signature of a race,
 * not of a product regression.
 *
 * REAL_CONNECTED specifically, not `DEMO_ACTIVE|REAL_CONNECTED` as the two sibling specs accept: this
 * test asserts the C64U hierarchy that the *mock server* reports, and demo mode serves its own
 * fixtures instead. Gating on the real connection means a failover surfaces as "expected
 * REAL_CONNECTED" rather than as a puzzling absent testid.
 */
const waitForRealConnection = async (page: Page) => {
  const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
  await expect(badge).toBeVisible({ timeout: 15000 });
  await expect(badge).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 15000 });
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

  test("config page shows the C64U menu hierarchy, and a named card per unplaced category", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/config");
    await waitForRealConnection(page);
    await snap(page, testInfo, "config-open");

    // The C64U device (mock /v1/info reports "C64 Ultimate") renders the menu-aligned
    // hierarchy: settings live under friendly menu pages, not raw REST categories.
    await expect(page.getByTestId("config-menu-page-video-setup")).toBeVisible();
    await expect(page.getByTestId("config-menu-page-turbo-boost")).toBeVisible();
    await expect(page.getByTestId("config-menu-page-network-services-&-timezone")).toBeVisible();
    // The Audio Mixer page keeps its specialized renderer (header "Audio mixer").
    await expect(page.getByRole("button", { name: "Audio mixer" })).toBeVisible();
    // A category the device menu does not place on a page gets a card of its own, named after the
    // category, instead of sharing one "Advanced (REST-only)" bin with every other one. Nothing is
    // hidden; the reader is told which subject they are looking at.
    await expect(page.getByTestId("config-advanced-fallback")).toHaveCount(0);
    await expect(page.getByTestId("config-unrouted-tape-settings")).toBeVisible();
    await page.getByTestId("config-unrouted-toggle-tape-settings").click();
    await expect(page.getByText("Tape Playback Rate")).toBeVisible();
    await snap(page, testInfo, "menu-hierarchy-visible");
  });
});
