/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server, type MockC64Server, type MockRequestRecord } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    { timeout: 10000 },
  );
};

const requestPathname = (request: MockRequestRecord) => new URL(request.url, "http://mock.c64u").pathname;

const isConfigMutation = (request: MockRequestRecord) => {
  const pathname = requestPathname(request);
  return (
    (request.method === "POST" && pathname === "/v1/configs") ||
    (request.method === "PUT" && pathname.startsWith("/v1/configs/"))
  );
};

const mutationsAfter = (server: MockC64Server, requestId: number) =>
  server.requests.filter((request) => request.requestId > requestId && isConfigMutation(request));

const waitForMutationDrain = async (server: MockC64Server, requestId: number) => {
  await expect
    .poll(() =>
      mutationsAfter(server, requestId).every(
        (request) => request.startedProcessingAtMs !== null && request.completedAtMs !== null,
      ),
    )
    .toBe(true);
};

test.describe("Structured interaction soak", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
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

  test("Home CPU slider and checkbox pressure remains responsive, connected, and request-bounded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForConnected(page);

    const cpuSlider = page.getByTestId("home-cpu-speed-slider");
    const cpuThumb = cpuSlider.getByRole("slider");
    await expect(cpuThumb).toBeEnabled();

    server.setLatencyMs(250);
    const beforeCpuPressure = server.requests.at(-1)?.requestId ?? 0;

    await cpuThumb.focus();
    for (let index = 0; index < 8; index += 1) {
      await cpuThumb.press("ArrowRight");
    }

    await expect(page.getByTestId("home-cpu-speed-value")).toHaveText("14", { timeout: 1000 });

    await page.getByTestId("tab-settings").click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await waitForConnected(page);
    await page.getByTestId("tab-home").click();
    await expect(cpuThumb).toBeVisible();
    await waitForConnected(page);

    await expect.poll(() => String(server.getState()["U64 Specific Settings"]["CPU Speed"]?.value)).toBe("14");
    await waitForMutationDrain(server, beforeCpuPressure);

    const cpuMutations = mutationsAfter(server, beforeCpuPressure).filter(
      (request) => request.method === "POST" && requestPathname(request) === "/v1/configs",
    );
    expect(cpuMutations.length).toBeLessThanOrEqual(5);

    server.setLatencyMs(50);
    const scanlines = page.getByTestId("home-video-scanlines");
    await scanlines.scrollIntoViewIfNeeded();
    await expect(scanlines).toBeEnabled();
    const beforeCheckboxPressure = server.requests.at(-1)?.requestId ?? 0;
    const expectedStates = ["Disabled", "Enabled", "Disabled", "Enabled", "Disabled"];

    for (const expectedState of expectedStates) {
      await expect(scanlines).toBeEnabled();
      await scanlines.click();
      await expect
        .poll(() => String(server.getState()["U64 Specific Settings"]["HDMI Scan lines"]?.value))
        .toBe(expectedState);
    }

    await expect(scanlines).toHaveAttribute("data-state", "unchecked");
    await waitForMutationDrain(server, beforeCheckboxPressure);
    const checkboxMutations = mutationsAfter(server, beforeCheckboxPressure).filter(
      (request) =>
        request.method === "PUT" &&
        requestPathname(request) === "/v1/configs/U64%20Specific%20Settings/HDMI%20Scan%20lines",
    );
    expect(checkboxMutations).toHaveLength(expectedStates.length);
    await waitForConnected(page);
  });
});
