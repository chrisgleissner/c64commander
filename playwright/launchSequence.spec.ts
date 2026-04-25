/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

import { createMockC64Server } from "../tests/mocks/mockC64Server";
import "../tests/mocks/setupMockConfigForTests";
import { DISPLAY_PROFILE_VIEWPORT_SEQUENCE, DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { seedUiMocks } from "./uiMocks";
import { allowVisualOverflow, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const SCREENSHOT_ROOT = path.resolve(process.cwd(), "docs/img/app/launch/profiles");
const VIDEO_ROOT = path.resolve(process.cwd(), "artifacts/video/startup-launch");
const VIDEO_CAPTURE_ROOT = path.resolve(process.cwd(), "test-results/playwright/startup-launch-video");
const PLAYWRIGHT_LAUNCH_TIMINGS = {
  fadeInMs: 900,
  holdMs: 1700,
  fadeOutMs: 700,
};
const PLAYWRIGHT_SCREENSHOT_LAUNCH_TIMINGS = {
  fadeInMs: 1200,
  holdMs: 2400,
  fadeOutMs: 1000,
};
const FADE_IN_SAMPLE_MS = 150;
const FADE_OUT_SAMPLE_MS = 125;
const HOME_READY_TEST_ID = "home-system-info";
const TEST_LAUNCH_TIMINGS_STORAGE_KEY = "c64u_test_launch_timings";

const applyDisplayProfileOverride = async (
  page: Page,
  profileId: keyof typeof DISPLAY_PROFILE_VIEWPORTS,
  launchTimings = PLAYWRIGHT_LAUNCH_TIMINGS,
) => {
  const profile = DISPLAY_PROFILE_VIEWPORTS[profileId];
  await page.setViewportSize(profile.viewport);
  await page.addInitScript(
    ({ override, launchTimings }) => {
      localStorage.setItem("c64u_display_profile_override", override);
      localStorage.setItem("c64u_motion_mode", "standard");
      window.__c64uLaunchSequenceTimings = launchTimings;
      window.dispatchEvent(
        new CustomEvent("c64u-ui-preferences-changed", {
          detail: { displayProfileOverride: override },
        }),
      );
    },
    { override: profile.override, launchTimings },
  );
};

const installStoredLaunchTimingBridge = async (page: Page) => {
  await page.addInitScript((storageKey) => {
    const storedTimings = localStorage.getItem(storageKey);
    if (!storedTimings) {
      return;
    }

    try {
      window.__c64uLaunchSequenceTimings = JSON.parse(storedTimings);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, TEST_LAUNCH_TIMINGS_STORAGE_KEY);
};

const configureLaunchProfileForReload = async (
  page: Page,
  profileId: keyof typeof DISPLAY_PROFILE_VIEWPORTS,
  launchTimings = PLAYWRIGHT_SCREENSHOT_LAUNCH_TIMINGS,
) => {
  const profile = DISPLAY_PROFILE_VIEWPORTS[profileId];

  await page.setViewportSize(profile.viewport);
  await page.evaluate(
    ({ override, storageKey, timings }) => {
      localStorage.setItem("c64u_display_profile_override", override);
      localStorage.setItem("c64u_motion_mode", "standard");
      localStorage.setItem(storageKey, JSON.stringify(timings));
    },
    {
      override: profile.override,
      storageKey: TEST_LAUNCH_TIMINGS_STORAGE_KEY,
      timings: launchTimings,
    },
  );
};

const readResolvedLaunchTimings = async (page: Page) => {
  const launchSequence = page.getByTestId("startup-launch-sequence");

  return launchSequence.evaluate((node) => ({
    fadeInMs: Number(node.getAttribute("data-fade-in-ms") ?? "0"),
    holdMs: Number(node.getAttribute("data-hold-ms") ?? "0"),
    fadeOutMs: Number(node.getAttribute("data-fade-out-ms") ?? "0"),
  }));
};

const waitForLaunchPhase = async (page: Page, phase: "fade-in" | "hold" | "fade-out") => {
  await page.waitForFunction(
    (expectedPhase) =>
      document.querySelector<HTMLElement>('[data-testid="startup-launch-sequence"]')?.dataset.phase === expectedPhase,
    phase,
    { polling: 16 },
  );
};

const waitForHoldSample = async (page: Page, timings: { fadeInMs: number; holdMs: number; fadeOutMs: number }) => {
  await page.waitForTimeout(timings.fadeInMs - FADE_IN_SAMPLE_MS + 75);
  await waitForLaunchPhase(page, "hold");
};

const expectFadeOutInProgress = async (page: Page) => {
  const launchSequence = page.getByTestId("startup-launch-sequence");

  await waitForLaunchPhase(page, "fade-out");
  await page.waitForTimeout(FADE_OUT_SAMPLE_MS);

  const overlayOpacity = await launchSequence.evaluate((node) => Number.parseFloat(getComputedStyle(node).opacity));
  expect(overlayOpacity).toBeGreaterThan(0);
  expect(overlayOpacity).toBeLessThan(1);
};

const waitForLaunchSequenceComplete = async (page: Page) => {
  await expect(page.getByTestId(HOME_READY_TEST_ID)).toBeVisible();
  await expect(page.getByTestId("startup-launch-sequence")).toHaveCount(0);
};

const beginLaunchRun = async (page: Page, options?: { navigate?: boolean; preparePage?: () => Promise<void> }) => {
  if (options?.preparePage) {
    await options.preparePage();
  } else if (options?.navigate !== false) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }

  const launchSequence = page.getByTestId("startup-launch-sequence");
  await expect(launchSequence).toBeVisible();

  return {
    launchSequence,
    resolvedTimings: await readResolvedLaunchTimings(page),
  };
};

const captureLaunchScreenshotsForProfile = async (
  page: Page,
  profileId: keyof typeof DISPLAY_PROFILE_VIEWPORTS,
  options?: { navigate?: boolean; preparePage?: () => Promise<void> },
) => {
  const profileDir = path.join(SCREENSHOT_ROOT, profileId);
  await fs.mkdir(profileDir, { recursive: true });

  {
    await beginLaunchRun(page, options);
    await waitForLaunchPhase(page, "fade-in");
    await page.waitForTimeout(FADE_IN_SAMPLE_MS);
    await page.screenshot({ path: path.join(profileDir, "01-fade-in.png") });
  }

  {
    const { resolvedTimings } = await beginLaunchRun(page, options);
    await waitForHoldSample(page, resolvedTimings);
    await page.screenshot({ path: path.join(profileDir, "02-hold.png") });
  }

  {
    await beginLaunchRun(page, options);
    await waitForLaunchPhase(page, "fade-out");
    await page.waitForTimeout(FADE_OUT_SAMPLE_MS);
    await page.screenshot({ path: path.join(profileDir, "03-fade-out.png") });
  }

  {
    await beginLaunchRun(page, options);
    await waitForLaunchSequenceComplete(page);
    await page.screenshot({ path: path.join(profileDir, "04-app-ready.png") });
  }
};

test.describe("launch sequence", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    allowVisualOverflow(testInfo, "Startup launch halo intentionally extends beyond the viewport edge.");
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
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

  test("shows the launch sequence on fresh load, reaches app-ready, and does not replay on SPA or resume signals", async ({
    page,
  }, testInfo: TestInfo) => {
    await applyDisplayProfileOverride(page, "medium");
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const launchSequence = page.getByTestId("startup-launch-sequence");
    await expect(launchSequence).toBeVisible();
    const resolvedTimings = await readResolvedLaunchTimings(page);
    await waitForLaunchPhase(page, "fade-in");
    await page.waitForTimeout(FADE_IN_SAMPLE_MS);

    await waitForHoldSample(page, resolvedTimings);
    await expect(launchSequence).toHaveAttribute("data-profile", "medium");
    await expect(page.getByTestId("startup-launch-sequence-title")).toBeVisible();
    await expect(page.getByTestId("startup-launch-sequence-description")).toBeVisible();

    await expectFadeOutInProgress(page);

    await waitForLaunchSequenceComplete(page);

    const resolvedCanvasColors = await page.evaluate(() => {
      const swipeContainer = document.querySelector<HTMLElement>('[data-testid="swipe-navigation-container"]');
      return {
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        swipeContainer: swipeContainer ? getComputedStyle(swipeContainer).backgroundColor : null,
      };
    });
    expect(resolvedCanvasColors.swipeContainer).toBe(resolvedCanvasColors.body);
    expect(resolvedCanvasColors.swipeContainer).not.toBe(resolvedCanvasColors.html);

    await page.getByTestId("tab-settings").click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("startup-launch-sequence")).toHaveCount(0);

    await page.evaluate(() => {
      window.dispatchEvent(new Event("pageshow"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await page.waitForTimeout(200);
    await expect(page.getByTestId("startup-launch-sequence")).toHaveCount(0);
  });

  test("keeps compact launch fade-out smooth when runtime motion remains standard", async ({ page }) => {
    await applyDisplayProfileOverride(page, "compact");
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const launchSequence = page.getByTestId("startup-launch-sequence");
    await expect(launchSequence).toBeVisible();
    const resolvedTimings = await readResolvedLaunchTimings(page);
    await waitForLaunchPhase(page, "fade-in");

    await waitForHoldSample(page, resolvedTimings);
    await expect(launchSequence).toHaveAttribute("data-profile", "compact");
    await expectFadeOutInProgress(page);

    await expect(launchSequence).toBeHidden();
    await expect(page.getByTestId(HOME_READY_TEST_ID)).toBeVisible();
  });

  test("@screenshots captures launch sequence screenshots for each display profile", async ({ page }) => {
    await installStoredLaunchTimingBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
      await captureLaunchScreenshotsForProfile(page, profileId, {
        navigate: false,
        preparePage: async () => {
          await configureLaunchProfileForReload(page, profileId);
          await page.reload({ waitUntil: "domcontentloaded" });
        },
      });
    }
  });

  test("@video records a launch-sequence video artifact for the medium profile", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    await fs.rm(VIDEO_CAPTURE_ROOT, { recursive: true, force: true });
    await fs.mkdir(VIDEO_ROOT, { recursive: true });
    await fs.mkdir(VIDEO_CAPTURE_ROOT, { recursive: true });

    const context = await browser.newContext({
      viewport: DISPLAY_PROFILE_VIEWPORTS.medium.viewport,
      recordVideo: {
        dir: VIDEO_CAPTURE_ROOT,
        size: DISPLAY_PROFILE_VIEWPORTS.medium.viewport,
      },
    });
    const page = await context.newPage();

    try {
      await seedUiMocks(page, server.baseUrl);
      await applyDisplayProfileOverride(page, "medium");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("startup-launch-sequence")).toBeVisible();
      await expect(page.getByTestId("startup-launch-sequence")).toBeHidden();
      await expect(page.getByTestId(HOME_READY_TEST_ID)).toBeVisible();
    } finally {
      const video = page.video();
      await context.close();
      if (video) {
        await video.saveAs(path.join(VIDEO_ROOT, "launch-sequence-medium.webm"));
      }
    }
  });
});
