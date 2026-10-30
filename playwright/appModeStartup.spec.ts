/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { allowWarnings } from "./testArtifacts";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";

type MockServer = Awaited<ReturnType<typeof createMockC64Server>>;

const ROUTES = ["/", "/play", "/disks", "/config", "/settings", "/docs"] as const;

const startWithMode = async (page: Page, server: MockServer, startupMode: string | null) => {
  await seedUiMocks(page, server.baseUrl);
  await page.addInitScript((mode: string | null) => {
    localStorage.setItem("c64u_display_profile_override", "compact");
    if (mode) localStorage.setItem("c64u_startup_mode", mode);
  }, startupMode);
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
};

test.describe("Start-up mode", () => {
  let server: MockServer;

  test.beforeEach(async ({ page: _page }, testInfo) => {
    disableTraceAssertions(testInfo, "Start-up mode coverage; trace assertions disabled.");
    allowWarnings(testInfo, "Device traffic is deliberately refused while SID Player is active.");
    server = await createMockC64Server({});
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("an app that starts in SID Player sends no request to the device on any page and shows no toast", async ({
    page,
  }) => {
    await startWithMode(page, server, "sid-player");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const badge = page.getByTestId("unified-health-badge").first();
    await expect(badge).toHaveAttribute("data-connectivity-state", "SID Player", { timeout: 30_000 });
    await expect(badge).toContainText("SID Player");

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
    }

    expect(server.requests).toEqual([]);
    await expect(page.getByTestId("app-toast")).toHaveCount(0);
    await expect(page.getByTestId("unified-health-badge").first()).toHaveAttribute(
      "data-connectivity-state",
      "SID Player",
    );
  });

  test("an app with the default start-up mode still probes its device and does not show SID Player", async ({
    page,
  }) => {
    await startWithMode(page, server, null);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect.poll(() => server.requests.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("unified-health-badge").first()).not.toHaveAttribute(
      "data-connectivity-state",
      "SID Player",
    );
  });
});
