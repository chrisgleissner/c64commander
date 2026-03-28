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
import {
  allowVisualOverflow,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

type SwipeLogEntry = {
  level: string;
  message: string;
  details?: Record<string, unknown>;
};

const DEBUG_LOGGING_KEY = "c64u_debug_logging_enabled";
const APP_LOGS_KEY = "c64u_app_logs";

const swipe = async (page: Page, fromX: number, fromY: number, toX: number, toY: number, steps = 20) => {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps });
  await page.mouse.up();
};

const getSwipeLane = async (page: Page) => {
  const box = await page.getByTestId("swipe-navigation-container").boundingBox();
  if (!box) throw new Error("Swipe navigation container bounding box is unavailable.");

  return {
    centerX: box.x + box.width / 2,
    y: box.y + 24,
    swipeLen: Math.min(260, box.width * 0.66),
  };
};

const readSwipeLogs = async (page: Page): Promise<SwipeLogEntry[]> =>
  page.evaluate((logsKey) => {
    const raw = localStorage.getItem(logsKey);
    const parsed = raw ? (JSON.parse(raw) as SwipeLogEntry[]) : [];
    return parsed.filter((entry) => entry.message.includes("[SwipeNav]"));
  }, APP_LOGS_KEY);

const waitForRouteIndex = async (page: Page, expectedIndex: number) => {
  await expect
    .poll(async () => page.getByTestId("swipe-navigation-runway").getAttribute("data-runway-index"), { timeout: 4000 })
    .toBe(String(expectedIndex));
  await expect
    .poll(async () => page.locator('[data-slot-active="true"]').getAttribute("data-route-index"), { timeout: 4000 })
    .toBe(String(expectedIndex));
};

const expectSwipeLog = async (page: Page, predicate: (entry: SwipeLogEntry) => boolean, message: string) => {
  await expect
    .poll(
      async () => {
        const entries = await readSwipeLogs(page);
        return entries.some(predicate);
      },
      { timeout: 4000, message },
    )
    .toBe(true);
};

const waitForCommittedRouteIndex = async (page: Page, expectedIndex: number) => {
  await waitForRouteIndex(page, expectedIndex);
  await expect(page.locator('[data-slot-active="true"]')).toHaveAttribute("data-route-index", String(expectedIndex));
  // Wait for the CSS transition to fully complete before the next swipe.
  // Polling for idle is more reliable than a fixed timeout on slow CI runners.
  await expect
    .poll(async () => page.getByTestId("swipe-navigation-runway").getAttribute("data-runway-phase"), { timeout: 8000 })
    .toBe("idle");
};

test.describe("Swipe navigation", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowVisualOverflow(testInfo, "Swipe navigation keeps adjacent pages partially visible during drag.");
    await page.addInitScript(
      ({ debugKey, logsKey }) => {
        localStorage.setItem(debugKey, "1");
        localStorage.setItem(logsKey, "[]");
      },
      { debugKey: DEBUG_LOGGING_KEY, logsKey: APP_LOGS_KEY },
    );
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

  test("swipe left from Home navigates to Play", async ({ page }, testInfo) => {
    await page.goto("/");
    await attachStepScreenshot(page, testInfo, "home-initial");

    const { centerX, y, swipeLen } = await getSwipeLane(page);

    await swipe(page, centerX, y, centerX - swipeLen, y);

    await waitForRouteIndex(page, 1);
    await attachStepScreenshot(page, testInfo, "play-after-swipe");
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByTestId("swipe-slot-play")).toHaveAttribute("data-slot-active", "true");

    await expectSwipeLog(
      page,
      (entry) =>
        entry.message === "[SwipeNav] transition-start" &&
        entry.details?.reason === "swipe" &&
        entry.details?.from === "Home" &&
        entry.details?.to === "Play",
      "Expected swipe transition log for Home -> Play.",
    );
    await expectSwipeLog(
      page,
      (entry) => entry.message === "[SwipeNav] gesture-classified" && entry.details?.classification === "navigating",
      "Expected gesture classification log.",
    );
  });

  test("swipe right from Play navigates to Home", async ({ page }, testInfo) => {
    await page.goto("/play");
    await waitForRouteIndex(page, 1);

    const { centerX, y, swipeLen } = await getSwipeLane(page);

    await swipe(page, centerX, y, centerX + swipeLen, y);

    await waitForRouteIndex(page, 0);
    await attachStepScreenshot(page, testInfo, "home-after-swipe");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("swipe-slot-home")).toHaveAttribute("data-slot-active", "true");
  });

  test("wrap-around swipe left from Docs navigates to Home", async ({ page }, testInfo) => {
    await page.goto("/docs");
    await waitForRouteIndex(page, 5);

    const { centerX, y, swipeLen } = await getSwipeLane(page);

    await swipe(page, centerX, y, centerX - swipeLen, y);

    await waitForRouteIndex(page, 0);
    await attachStepScreenshot(page, testInfo, "home-after-wrap");
    await expect(page).toHaveURL(/\/$/);

    await expectSwipeLog(
      page,
      (entry) =>
        entry.message === "[SwipeNav] transition-start" &&
        entry.details?.reason === "swipe" &&
        entry.details?.from === "Docs" &&
        entry.details?.to === "Home" &&
        entry.details?.wrapAround === true,
      "Expected wrap-around swipe log for Docs -> Home.",
    );
  });

  test("wrap-around swipe right from Home navigates to Docs", async ({ page }, testInfo) => {
    await page.goto("/");
    await waitForRouteIndex(page, 0);

    const { centerX, y, swipeLen } = await getSwipeLane(page);

    await swipe(page, centerX, y, centerX + swipeLen, y);

    await waitForRouteIndex(page, 5);
    await attachStepScreenshot(page, testInfo, "docs-after-wrap");
    await expect(page).toHaveURL(/\/docs$/);

    await expectSwipeLog(
      page,
      (entry) =>
        entry.message === "[SwipeNav] transition-start" &&
        entry.details?.reason === "swipe" &&
        entry.details?.from === "Home" &&
        entry.details?.to === "Docs" &&
        entry.details?.wrapAround === true,
      "Expected wrap-around swipe log for Home -> Docs.",
    );
  });

  test("slider interaction does not trigger swipe navigation", async ({ page }, testInfo) => {
    await page.goto("/");
    await waitForRouteIndex(page, 0);

    const slider = page.getByTestId("home-cpu-speed-slider");
    await expect(slider).toBeVisible();
    const thumb = slider.getByRole("slider");
    await expect(thumb).toBeVisible();

    const box = await thumb.boundingBox();
    if (!box) throw new Error("CPU speed slider thumb bounding box is unavailable.");

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 6, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 6, y, { steps: 12 });
    await page.mouse.up();

    await page.waitForTimeout(250);
    await attachStepScreenshot(page, testInfo, "home-after-slider-drag");
    await waitForRouteIndex(page, 0);
    await expect(page).toHaveURL(/\/$/);

    await expectSwipeLog(
      page,
      (entry) =>
        entry.message === "[SwipeNav] gesture-classified" &&
        entry.details?.classification === "ignored" &&
        entry.details?.reason === "interactive-origin",
      "Expected swipe ignore log for slider interaction.",
    );
  });

  test("tab bar tap still navigates using shared state", async ({ page }, testInfo) => {
    await page.goto("/");
    await waitForRouteIndex(page, 0);

    await page.getByTestId("tab-config").click();

    await waitForRouteIndex(page, 3);
    await attachStepScreenshot(page, testInfo, "config-via-tab");
    await expect(page).toHaveURL(/\/config$/);
    await expect(page.getByTestId("swipe-slot-config")).toHaveAttribute("data-slot-active", "true");
  });

  test("rapid consecutive swipes do not corrupt state", async ({ page }, testInfo) => {
    await page.goto("/");
    await waitForCommittedRouteIndex(page, 0);

    const { centerX, y, swipeLen } = await getSwipeLane(page);

    await swipe(page, centerX, y, centerX - swipeLen, y);
    await waitForCommittedRouteIndex(page, 1);

    await swipe(page, centerX, y, centerX - swipeLen, y);
    await waitForCommittedRouteIndex(page, 2);

    await swipe(page, centerX, y, centerX - swipeLen, y);
    await waitForCommittedRouteIndex(page, 3);

    await attachStepScreenshot(page, testInfo, "config-after-rapid-swipes");
    await expect(page).toHaveURL(/\/config$/);
    await expect(page.getByTestId("swipe-slot-config")).toHaveAttribute("data-slot-active", "true");
  });
});
