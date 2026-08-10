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
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

/*
 * A device is only obliged to answer the documented REST surface. It may answer
 * with valid but sparse payloads: a short category list, items without a
 * `details` block, and `{"errors":[]}` for anything it does not implement.
 *
 * Home must degrade to "Not available" for whatever such a device omits. It must
 * never render the page error boundary.
 */

const ADVERTISED_CATEGORIES = ["Audio Mixer", "SID Settings"];

/** Sparse but well-formed category payloads: `selected` + `options`, no `details`. */
const CATEGORY_ITEMS: Record<string, Record<string, { selected: number | string; options: Array<number | string> }>> = {
  "Audio Mixer": {
    "Vol UltiSid 1": { selected: 40, options: [0, 20, 40, 60, 80, 100] },
    "Vol UltiSid 2": { selected: 40, options: [0, 20, 40, 60, 80, 100] },
  },
  "SID Settings": {
    "SID Detection": { selected: "Enabled", options: ["Disabled", "Enabled"] },
  },
};

/** Every path the device does not implement answers 200 with an empty error list. */
const EMPTY_BODY = { errors: [] as string[] };

const routeMinimalDevice = async (page: Page, seenPaths: string[]) => {
  await page.route("**/v1/**", async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    seenPaths.push(`${route.request().method()} ${path}`);

    const body = (() => {
      if (path === "/v1/info") {
        return {
          product: "C64 Ultimate",
          hostname: "c64u",
          firmware_version: "3.12.0",
          core_version: "1.0.0",
          unique_id: "minimal-mock",
          errors: [],
        };
      }
      if (path === "/v1/version") {
        return { version: "3.12.0", errors: [] };
      }
      if (path === "/v1/configs") {
        return { categories: ADVERTISED_CATEGORIES, errors: [] };
      }
      const category = path.startsWith("/v1/configs/") ? path.slice("/v1/configs/".length) : null;
      if (category && CATEGORY_ITEMS[category]) {
        return { [category]: CATEGORY_ITEMS[category], errors: [] };
      }
      if (path === "/v1/drives") {
        return { drives: [{ a: { enabled: true, bus_id: 8, type: "1541" } }], errors: [] };
      }
      return EMPTY_BODY;
    })();

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
};

test.describe("Home against a device that answers only the minimum REST surface", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    // Required before anything else: the suite enables trace assertions in CI, and
    // testArtifacts throws "Trace assertions enabled but strict UI monitoring was not
    // started" for a spec that skips this. The spec passed locally without it because
    // that flag is off by default.
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl, { clearStorageBeforeSeeding: true });
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

  test("renders Home instead of the page error boundary", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(`${error.message}\n${error.stack ?? "<no stack>"}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const seenPaths: string[] = [];
    await routeMinimalDevice(page, seenPaths);

    await page.goto("/");

    await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
      "data-connection-state",
      "REAL_CONNECTED",
      { timeout: 20000 },
    );

    // Home's summary cards only render device values once the per-category reads
    // have come back, so wait for those before judging the page.
    await expect.poll(() => seenPaths.filter((entry) => entry.includes("/v1/configs/")).length).toBeGreaterThan(0);

    await attachStepScreenshot(page, testInfo, "home-on-minimal-device");

    if (pageErrors.length || consoleErrors.length) {
      console.log("page errors:\n", pageErrors.join("\n---\n"));
      console.log("console errors:\n", consoleErrors.join("\n"));
    }

    await expect(page.getByTestId("page-error-boundary-fallback")).toHaveCount(0);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByTestId("home-header-title")).toBeVisible();
    // "Quick Config" dissolved into separate collapsible cards; CPU & RAM (open by
    // default) is the equivalent sanity check that those cards rendered.
    await expect(page.getByTestId("home-cpu-summary")).toBeVisible();
    expect(pageErrors, `unhandled page errors:\n${pageErrors.join("\n---\n")}`).toEqual([]);
  });
});
