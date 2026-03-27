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
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

const MAX_HEADER_OVERLAP_DELTA_PX = 12;

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

const applyMediumDisplayProfile = async (page: Page) => {
  const profile = DISPLAY_PROFILE_VIEWPORTS.medium;
  await page.setViewportSize(profile.viewport);
  await page.evaluate((override) => {
    localStorage.setItem("c64u_display_profile_override", override);
    window.dispatchEvent(
      new CustomEvent("c64u-ui-preferences-changed", {
        detail: { displayProfileOverride: override },
      }),
    );
  }, profile.override);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.displayProfile)).toBe("medium");
};

const boxesOverlap = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

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

    const saveNameInput = page.getByTestId("lighting-profile-save-name");
    await saveNameInput.scrollIntoViewIfNeeded();
    await saveNameInput.fill("Night Ride");
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

  test("header uses the shared close row without handle or collapse controls", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await waitForConnected(page);

    await page.getByTestId("home-lighting-studio").click();

    const studioSheet = page.getByTestId("lighting-studio-sheet");
    await expect(studioSheet).toBeVisible();
    await expect(page.getByTestId("lighting-sheet-handle")).toHaveCount(0);
    await expect(page.getByTestId("lighting-sheet-toggle")).toHaveCount(0);

    const closeBtn = studioSheet.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn.locator("svg")).toHaveCount(0);
    await expect.poll(() => closeBtn.evaluate((button) => button.textContent ?? "")).toContain("×");
  });

  test("medium layout keeps the simplified keyboard blocks and avoids header/card clipping", async ({
    page,
  }: {
    page: Page;
  }) => {
    await seedLightingStudioState(page, {
      activeProfileId: "studio-neon",
      profiles: [
        {
          id: "studio-neon",
          name: "Neon Orbit",
          savedAt: "2026-01-10T08:30:00.000Z",
          pinned: true,
          surfaces: {
            case: {
              mode: "Fixed Color",
              pattern: "SingleColor",
              color: { kind: "named", value: "Blue" },
              intensity: 22,
              tint: "Pure",
            },
            keyboard: {
              mode: "Fixed Color",
              pattern: "SingleColor",
              color: { kind: "named", value: "Green" },
              intensity: 18,
              tint: "Warm",
            },
          },
        },
      ],
      automation: {
        connectionSentinel: {
          enabled: true,
          mappings: {
            connected: "studio-neon",
          },
        },
      },
    });

    await page.goto("/");
    await waitForConnected(page);
    await applyMediumDisplayProfile(page);

    await page.getByTestId("home-lighting-studio").click();
    const dialog = page.getByRole("dialog", { name: "Lighting Studio" });
    await expect(dialog).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    const closeBox = await page.getByTestId("lighting-studio-close").boundingBox();
    const activeProfileChipBox = await page.getByTestId("lighting-active-profile-chip").boundingBox();
    const profileCardBox = await page.getByTestId("lighting-profile-detail-card").boundingBox();
    const mockupBox = await page.getByTestId("lighting-device-mockup").boundingBox();
    const mainBlockBox = await page.getByTestId("lighting-mockup-main-block").boundingBox();
    const functionBlockBox = await page.getByTestId("lighting-mockup-function-block").boundingBox();
    const ledStrip = page.getByTestId("lighting-mockup-led-strip");

    expect(dialogBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(activeProfileChipBox).not.toBeNull();
    expect(profileCardBox).not.toBeNull();
    expect(mockupBox).not.toBeNull();
    expect(mainBlockBox).not.toBeNull();
    expect(functionBlockBox).not.toBeNull();

    expect(boxesOverlap(closeBox!, activeProfileChipBox!)).toBe(false);
    expect(profileCardBox!.x).toBeGreaterThanOrEqual(dialogBox!.x - 1);
    expect(profileCardBox!.x + profileCardBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
    expect(mockupBox!.x).toBeGreaterThanOrEqual(dialogBox!.x - 1);
    expect(mockupBox!.x + mockupBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
    expect(mainBlockBox!.width).toBeGreaterThan(functionBlockBox!.width * 3.5);
    expect(mainBlockBox!.x).toBeLessThan(functionBlockBox!.x);
    expect(functionBlockBox!.x).toBeGreaterThan(mainBlockBox!.x + mainBlockBox!.width * 0.55);
    expect(functionBlockBox!.height).toBeGreaterThan(mainBlockBox!.height * 0.6);
    await expect(ledStrip).toBeVisible();
    await expect(ledStrip).toHaveAttribute("fill", "#F5F5F5");
    await expect(ledStrip).toHaveAttribute("fill-opacity", "0.94");
  });

  test("diagnostics and lighting sheets stay below the badge and lighting opens in a high-overlap position", async ({
    page,
  }: {
    page: Page;
  }) => {
    await seedLightingStudioState(page, {
      activeProfileId: null,
      profiles: [],
      automation: {},
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForConnected(page);

    const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    const badgeBox = await badge.boundingBox();
    expect(badgeBox).not.toBeNull();

    await badge.click();
    const diagnosticsSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagnosticsSheet).toBeVisible();
    const diagnosticsBox = await diagnosticsSheet.boundingBox();
    expect(diagnosticsBox).not.toBeNull();

    const minimumSheetTop = badgeBox!.y + badgeBox!.height - MAX_HEADER_OVERLAP_DELTA_PX;
    expect(diagnosticsBox!.y).toBeGreaterThanOrEqual(minimumSheetTop - 4);

    await diagnosticsSheet.getByRole("button", { name: "Close" }).click();
    await expect(diagnosticsSheet).toBeHidden();

    await page.getByTestId("home-lighting-studio").click();
    const lightingSheet = page.getByTestId("lighting-studio-sheet");
    await expect(lightingSheet).toBeVisible();
    const lightingBox = await lightingSheet.boundingBox();
    expect(lightingBox).not.toBeNull();
    expect(lightingBox!.y).toBeGreaterThanOrEqual(minimumSheetTop - 4);
    expect(lightingBox!.y).toBeLessThanOrEqual(160);
  });
});
