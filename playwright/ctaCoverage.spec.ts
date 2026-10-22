/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Critical & High Priority CTA Coverage Tests
 *
 * Tests for previously uncovered CTAs identified in docs/ux-interactions.md:
 * - CRITICAL: Add disks to library flow
 * - HIGH: Shuffle mode, Home quick actions, Drive navigation
 * - HIGH: Disk browser source selection
 */

import { test, expect } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import {
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
  assertNoUiIssues,
  allowWarnings,
} from "./testArtifacts";
import { enableTraceAssertions } from "./traceUtils";
import { enableGoldenTrace } from "./goldenTraceRegistry";
import { getSourceSelectionButton } from "./sourceSelection";

const waitForUiStable = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle");
};

test.describe("Critical CTA Coverage", () => {
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

  test("add disks to library flow shows source selection", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/disks");
    await attachStepScreenshot(page, testInfo, "disks-page");

    // Find "Add disks" or "Add more disks" button
    const addButton = page.getByRole("button", { name: /Add (more )?disks/i });
    await expect(addButton).toBeVisible();
    await attachStepScreenshot(page, testInfo, "add-button-visible");

    await addButton.click();
    await waitForUiStable(page);
    await attachStepScreenshot(page, testInfo, "source-selection-opened");

    // Should show source selection: Local and C64 Ultimate
    const dialog = page.getByRole("dialog");
    const localButton = getSourceSelectionButton(dialog, "This device");
    const c64uButton = getSourceSelectionButton(dialog, "C64 Ultimate");

    const hasLocalOption = await localButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasC64UOption = await c64uButton.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasLocalOption || hasC64UOption).toBe(true);
    await attachStepScreenshot(page, testInfo, "source-options-available");
  });
});

test.describe("Shuffle Mode Tests", () => {
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

  test("shuffle icon toggles shuffle mode", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    const shuffle = page.getByRole("button", { name: "Shuffle", exact: true });
    await shuffle.scrollIntoViewIfNeeded();
    const initialState = (await shuffle.getAttribute("aria-pressed")) === "true";
    await shuffle.click();
    await expect(shuffle).toHaveAttribute("aria-pressed", String(!initialState));
    await attachStepScreenshot(page, testInfo, "shuffle-toggled");
  });

  test("repeat stays independent of shuffle and has no separate reshuffle control", async ({ page }, testInfo) => {
    await page.goto("/play");
    const shuffle = page.getByTestId("playback-shuffle");
    const repeat = page.getByTestId("playback-repeat");
    await shuffle.click();
    for (const mode of ["playlist", "tune", "off"]) {
      await repeat.click();
      await expect(repeat).toHaveAccessibleName(`Repeat: ${mode}`);
      await expect(shuffle).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByRole("button", { name: "Reshuffle", exact: true })).toHaveCount(0);
    await attachStepScreenshot(page, testInfo, "independent-playback-modes");
  });
});

test.describe("Home Page Quick actions", () => {
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

  test("home page displays quick action cards for machine control", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await page.goto("/");
    await attachStepScreenshot(page, testInfo, "home-page");

    // Check for machine control quick actions
    const resetButton = page.getByRole("button", { name: /reset/i });
    const menuButton = page.getByRole("button", { name: /menu/i });
    const pauseButton = page.getByRole("button", { name: /pause/i });
    const resumeButton = page.getByRole("button", { name: /resume/i });
    const powerButton = page.getByRole("button", { name: /power/i });

    const hasReset = await resetButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasMenu = await menuButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasPause = await pauseButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasResume = await resumeButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasPower = await powerButton.isVisible({ timeout: 2000 }).catch(() => false);

    const machineControlCount = [hasReset, hasMenu, hasPause, hasResume, hasPower].filter(Boolean).length;
    expect(machineControlCount).toBeGreaterThan(0);
    await attachStepScreenshot(page, testInfo, `machine-controls-found-${machineControlCount}`);
  });

  test("home page displays config management quick actions", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/");
    await attachStepScreenshot(page, testInfo, "home-page");

    /*
     * The Config card, opened.
     *
     * This test used to read Home with every card closed, where none of the Config actions is in
     * the DOM at all — it was passing on the "Save RAM" and "Load RAM" tiles in Quick actions,
     * which matched /save/i and /load/i and are not config management. Renaming those to Backup and
     * Restore is what exposed it. The card has to be open for this to be a test of what it says.
     */
    const configToggle = page.getByTestId("home-section-toggle-config-actions");
    await configToggle.waitFor({ state: "visible", timeout: 30_000 });
    if ((await configToggle.getAttribute("aria-expanded")) !== "true") {
      await configToggle.scrollIntoViewIfNeeded();
      await configToggle.click();
    }
    await page.getByTestId("home-config-actions").waitFor({ state: "visible", timeout: 15_000 });

    // Check for config management quick actions
    const applyButton = page.getByRole("button", { name: /apply/i });
    const saveButton = page.getByRole("button", { name: /save/i });
    const loadButton = page.getByRole("button", { name: /load/i });
    const revertButton = page.getByRole("button", { name: /revert/i });
    const manageButton = page.getByRole("button", { name: /manage/i });

    const hasApply = await applyButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasSave = await saveButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasLoad = await loadButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasRevert = await revertButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasManage = await manageButton.isVisible({ timeout: 2000 }).catch(() => false);

    const configControlCount = [hasApply, hasSave, hasLoad, hasRevert, hasManage].filter(Boolean).length;
    expect(configControlCount).toBeGreaterThan(0);
    await attachStepScreenshot(page, testInfo, `config-controls-found-${configControlCount}`);
  });

  test("home drives group exposes inline controls without navigation dependency", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/");
    await attachStepScreenshot(page, testInfo, "home-page");

    const drivesGroup = page.getByTestId("home-drives-group");
    await expect(drivesGroup).toBeVisible();
    await expect(page.getByTestId("home-drives-reset")).toBeVisible();
    await expect(page.getByTestId("home-drive-toggle-a")).toBeVisible();
    await expect(page.getByTestId("home-drive-toggle-b")).toBeVisible();
    await expect(page.getByTestId("home-drive-toggle-soft-iec")).toBeVisible();
    await expect(page.getByTestId("home-drive-link-a")).toBeVisible();
    await page.getByTestId("home-drive-details-toggle-a").click();
    await expect(page.getByTestId("home-drive-bus-a")).toBeVisible();
    await expect(page.getByTestId("home-drive-type-a")).toBeVisible();

    expect(new URL(page.url()).pathname).toBe("/");
    await attachStepScreenshot(page, testInfo, "home-drives-inline-controls");
  });
});

test.describe("Disk Browser Coverage", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    // Allow expected FTP warnings when browsing without FTP bridge
    allowWarnings(testInfo, "Expected FTP unavailable warnings in disk browser");
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

  test("disk browser allows source selection", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/disks");
    await attachStepScreenshot(page, testInfo, "disks-page");

    // Open disk browser
    const addButton = page.getByRole("button", { name: /Add (more )?items/i });
    const hasAddButton = await addButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasAddButton) {
      await addButton.click();
      await waitForUiStable(page);
      await attachStepScreenshot(page, testInfo, "browser-opened");

      // Verify source selection available
      const dialog = page.getByRole("dialog");
      const localOption = getSourceSelectionButton(dialog, "This device");
      const c64uOption = getSourceSelectionButton(dialog, "C64 Ultimate");

      const hasLocal = await localOption.isVisible({ timeout: 2000 }).catch(() => false);
      const hasC64U = await c64uOption.isVisible({ timeout: 2000 }).catch(() => false);

      expect(hasLocal || hasC64U).toBe(true);
      await attachStepScreenshot(page, testInfo, "source-selection-available");

      // Try selecting a source
      if (hasC64U) {
        await c64uOption.click();
        await waitForUiStable(page);
        await attachStepScreenshot(page, testInfo, "c64u-source-selected");
      }
    } else {
      await attachStepScreenshot(page, testInfo, "add-button-not-found");
    }
  });
});
