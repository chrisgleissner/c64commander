/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { allowWarnings, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

/**
 * HARD15-001 + HARD15-003 end-to-end: every current c64u (firmware 1.1.0) has
 * no `machine:input` support, so the Remote Input Keys tab falls back to the
 * kernal keyboard-buffer injector. Forces that tier by making the
 * `machine:input` probe 404, then burst-types `LOAD"*",8,1` (including the
 * shifted-digit quote character) without waiting between key taps, and
 * asserts the mock received the complete, correctly-ordered byte stream -
 * proving the FIFO serialization (HARD15-001) and the shifted number-row
 * mapping (HARD15-003) together.
 */

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    { timeout: 10000 },
  );
};

test.describe("Remote Input kernal-fallback typing (HARD15-001, HARD15-003)", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
    // Force the kernal-fallback tier: the real mock server otherwise answers
    // machine:input with 200 (full tier). Every other endpoint (readmem/
    // writemem, config, info) passes through to the mock server untouched.
    await page.route("**/v1/machine:input*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ errors: ["Not found"] }),
      }),
    );
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('burst-types LOAD"*",8,1 on the Keys tab and delivers the complete, ordered byte stream', async ({
    page,
  }, testInfo) => {
    allowWarnings(testInfo, "Deliberate machine:input 404 stub forces the kernal-fallback tier under test.");
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-machine-inline-openRemoteInput").click();
    await expect(page.getByTestId("remote-input-sheet")).toBeVisible();
    await page.getByTestId("remote-input-mode-type").click();
    await expect(page.getByTestId("remote-input-type-keyboard")).toBeVisible();

    // LOAD"*",8,1 - each quote is the one-shot SHIFT latch + digit "2"
    // (HARD15-003); every key is tapped back-to-back, not awaited between
    // taps, so the injections race exactly as fast typing would without the
    // HARD15-001 FIFO serialization fix.
    const keyTaps = ["l", "o", "a", "d", "shift", "2", "star", "shift", "2", "comma", "8", "comma", "1"];
    for (const key of keyTaps) {
      await page.getByTestId(`remote-input-key-${key}`).click();
    }

    const dataWrites = () =>
      server.requests
        .filter((req) => req.method === "PUT" && req.url.startsWith("/v1/machine:writemem?address=0277"))
        .map((req) => new URL(req.url, "http://127.0.0.1").searchParams.get("data"));

    await expect.poll(() => dataWrites().length, { timeout: 15000 }).toBe(11);

    expect(dataWrites()).toEqual(["4c", "4f", "41", "44", "22", "2a", "22", "2c", "38", "2c", "31"]);
  });
});
