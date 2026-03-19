/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

const waitForConnected = async (page: Page) => {
  await expect(page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge")).toHaveAttribute(
    "data-connection-state",
    "REAL_CONNECTED",
    {
      timeout: 10000,
    },
  );
};

const getActiveSlot = (page: Page) => page.locator('[data-slot-active="true"]');

const seedLightingStudioState = async (page: Page, state: unknown) => {
  await page.addInitScript((payload) => {
    localStorage.setItem("c64u_lighting_studio_state:v1", JSON.stringify(payload));
  }, state);
};

test.describe("Lighting Studio", () => {
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

  test("profile workflows and home chips stay coherent", async ({ page }: { page: Page }) => {
    await seedLightingStudioState(page, {
      activeProfileId: null,
      profiles: [],
      automation: {
        connectionSentinel: {
          enabled: true,
          mappings: {
            connected: "bundled-connected",
          },
        },
      },
    });

    await page.goto("/");
    await waitForConnected(page);

    await expect(page.getByTestId("home-lighting-automation-chip")).toHaveText("Auto: Connected");
    await page.getByTestId("home-lighting-studio").click();
    await expect(page.getByRole("dialog", { name: "Lighting Studio" })).toBeVisible();

    await page.getByTestId("lighting-profile-save-name").fill("Night Ride");
    await page.getByTestId("lighting-profile-save").click();
    await page.getByRole("button", { name: /Night Ride/ }).click();

    await page.getByTestId("lighting-profile-pin").click();
    await expect(page.getByTestId("lighting-profile-pin")).toContainText("Unpin");

    await page.getByTestId("lighting-profile-duplicate").click();
    await expect(page.getByRole("button", { name: /Night Ride Copy/ })).toBeVisible();

    await page.getByRole("button", { name: /Night Ride Copy/ }).click();
    await page.getByTestId("lighting-profile-rename-input").fill("Neon City");
    await page.getByTestId("lighting-profile-rename").click();
    await expect(page.getByRole("button", { name: /Neon City/ })).toBeVisible();

    await page.getByRole("button", { name: /Neon City/ }).click();
    await page.getByTestId("lighting-profile-delete").click();
    await expect(page.getByRole("button", { name: /Neon City/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Night Ride/ }).click();
    await page.getByTestId("lighting-profile-apply").click();
    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.getByTestId("home-lighting-profile-chip")).toContainText("Night Ride");
  });

  test("source cues and circadian fallback remain usable with denied device location", async ({
    page,
  }: {
    page: Page;
  }) => {
    await seedLightingStudioState(page, {
      activeProfileId: "bundled-connected",
      profiles: [],
      automation: {
        sourceIdentityMap: {
          enabled: true,
          mappings: {
            disks: "bundled-source-disks",
          },
        },
        circadian: {
          enabled: true,
          locationPreference: {
            useDeviceLocation: false,
            manualCoordinates: null,
            city: "London",
          },
        },
      },
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) =>
            error({ code: 1, message: "Permission denied" } as GeolocationPositionError),
        },
      });
    });

    await page.goto("/disks");
    await waitForConnected(page);

    const cue = getActiveSlot(page).getByTestId("lighting-automation-cue");
    await expect(cue).toContainText("Disk look");
    await cue.getByRole("button", { name: "Studio" }).click();

    await page.getByTestId("lighting-city-search").fill("tok");
    await page.getByTestId("lighting-city-option-tokyo").click();
    await page.getByTestId("lighting-apply-city").click();
    await expect(page.getByTestId("lighting-circadian-location")).toContainText("Tokyo");

    await page.getByTestId("lighting-manual-latitude").fill("123");
    await expect(page.getByTestId("lighting-manual-latitude-error")).toContainText("between -90 and 90");
    await expect(page.getByTestId("lighting-apply-manual-coordinates")).toBeDisabled();

    await page.getByTestId("lighting-manual-latitude").fill("35.6");
    await page.getByTestId("lighting-manual-longitude").fill("139.6");
    await page.getByTestId("lighting-apply-manual-coordinates").click();
    await expect(page.getByTestId("lighting-circadian-location")).toContainText("Manual 35.600, 139.600");

    await page.getByTestId("lighting-use-device-location").click();
    await page.getByTestId("lighting-request-device-location").click();
    await expect(page.getByTestId("lighting-device-location-status")).toContainText("denied");
    await expect(page.getByTestId("lighting-circadian-fallback")).toHaveText(/Fallback schedule|Solar schedule/);
  });
});
