/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { allowWarnings } from "./testArtifacts";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";

/*
 * The Docs say a gray dotted ring means offline and a solid gray ring means "not connected yet".
 * An unreachable saved device drew the solid ring and lost its name from the badge.
 */
test("the badge names an offline device and draws the dotted offline ring @layout", async ({ page }, testInfo) => {
  disableTraceAssertions(testInfo, "Offline badge coverage; trace assertions disabled.");
  allowWarnings(testInfo, "The device is deliberately unreachable.");
  const server = await createMockC64Server({});
  const host = new URL(server.baseUrl).host;
  await seedUiMocks(page, server.baseUrl);
  await page.addInitScript((deviceHost: string) => {
    localStorage.setItem("c64u_display_profile_override", "compact");
    localStorage.setItem("c64u_demo_mode_enabled", "0");
    localStorage.removeItem("c64u_automatic_demo_mode_enabled");
    const device = (id: string, name: string, h: string) => ({
      id,
      name,
      nameSource: "USER",
      host: h,
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastSuccessfulConnectionAt: null,
      lastUsedAt: null,
      hasPassword: false,
    });
    localStorage.setItem(
      "c64u_saved_devices:v1",
      JSON.stringify({
        version: 1,
        selectedDeviceId: "device-a",
        devices: [device("device-a", "Workshop", deviceHost), device("device-b", "Living rm", "c64u-other")],
        summaries: {},
        summaryLru: [],
        hasEverHadMultipleDevices: true,
      }),
    );
  }, host);
  await server.close();
  await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
  await expect(badge).toHaveAttribute("data-connectivity-state", "Offline", { timeout: 30_000 });
  await expect(badge.locator("svg[data-health-shape]")).toHaveAttribute("data-health-shape", "Unavailable");
  await expect(badge.getByTestId("unified-health-badge-device")).toHaveText("Workshop");
});
