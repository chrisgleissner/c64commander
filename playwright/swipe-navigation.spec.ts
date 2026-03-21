/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
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

const visibleWidth = (box: { x: number; width: number } | null, viewportWidth: number) => {
  if (!box) return 0;
  const left = Math.max(box.x, 0);
  const right = Math.min(box.x + box.width, viewportWidth);
  return Math.max(0, right - left);
};

const assertBothPagesVisible = async (
  page: Page,
  sourceSlot: string,
  targetSlot: string,
  direction: "left" | "right",
) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Viewport size is unavailable.");

  const [sourceBox, targetBox] = await Promise.all([
    page.getByTestId(sourceSlot).boundingBox(),
    page.getByTestId(targetSlot).boundingBox(),
  ]);

  expect(visibleWidth(sourceBox, viewport.width)).toBeGreaterThan(24);
  expect(visibleWidth(targetBox, viewport.width)).toBeGreaterThan(24);

  if (!sourceBox || !targetBox) {
    throw new Error(`Expected ${sourceSlot} and ${targetSlot} to have bounding boxes during swipe.`);
  }

  if (direction === "left") {
    expect(sourceBox.x).toBeLessThan(0);
    expect(targetBox.x).toBeGreaterThanOrEqual(0);
  } else {
    expect(sourceBox.x).toBeGreaterThan(0);
    expect(targetBox.x).toBeLessThanOrEqual(0);
  }
};

const captureTransitionPhase = async (
  page: Page,
  testInfo: TestInfo,
  caseName: string,
  phase: "early" | "mid" | "late",
  sourceSlot: string,
  targetSlot: string,
) => {
  const artifactDir = path.resolve("doc/img/app/details/swipe-transitions", caseName);
  await fs.mkdir(artifactDir, { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
  await assertBothPagesVisible(page, sourceSlot, targetSlot, "left");
  await page.screenshot({ path: path.join(artifactDir, `${phase}.png`) });
  await attachStepScreenshot(page, testInfo, `${caseName}-${phase}`);
};

const swipeWithMidTransitionScreenshots = async (
  page: Page,
  testInfo: TestInfo,
  options: {
    caseName: string;
    fromX: number;
    fromY: number;
    totalDx: number;
    sourceSlot: string;
    targetSlot: string;
  },
) => {
  await page.mouse.move(options.fromX, options.fromY);
  await page.mouse.down();

  await page.mouse.move(options.fromX + options.totalDx * 0.25, options.fromY, { steps: 5 });
  await captureTransitionPhase(page, testInfo, options.caseName, "early", options.sourceSlot, options.targetSlot);

  await page.mouse.move(options.fromX + options.totalDx * 0.5, options.fromY, { steps: 5 });
  await captureTransitionPhase(page, testInfo, options.caseName, "mid", options.sourceSlot, options.targetSlot);

  await page.mouse.move(options.fromX + options.totalDx * 0.75, options.fromY, { steps: 5 });
  await captureTransitionPhase(page, testInfo, options.caseName, "late", options.sourceSlot, options.targetSlot);

  await page.mouse.move(options.fromX + options.totalDx, options.fromY, { steps: 5 });
  await page.mouse.up();
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

  const cx = 195;
  const cy = 400;
  const swipeLen = 260;

  test("swipe left from Home navigates to Play", async ({ page }, testInfo) => {
    await page.goto("/");
    await attachStepScreenshot(page, testInfo, "home-initial");

    await swipe(page, cx, cy, cx - swipeLen, cy);

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

    await swipe(page, cx, cy, cx + swipeLen, cy);

    await waitForRouteIndex(page, 0);
    await attachStepScreenshot(page, testInfo, "home-after-swipe");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("swipe-slot-home")).toHaveAttribute("data-slot-active", "true");
  });

  test("wrap-around swipe left from Docs navigates to Home", async ({ page }, testInfo) => {
    await page.goto("/docs");
    await waitForRouteIndex(page, 5);

    await swipe(page, cx, cy, cx - swipeLen, cy);

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

    await swipe(page, cx, cy, cx + swipeLen, cy);

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

  test("mid-transition screenshots show Home and Play together", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    });
    await page.goto("/");
    await waitForRouteIndex(page, 0);

    await swipeWithMidTransitionScreenshots(page, testInfo, {
      caseName: "home-to-play",
      fromX: cx,
      fromY: cy,
      totalDx: -swipeLen,
      sourceSlot: "swipe-slot-home",
      targetSlot: "swipe-slot-play",
    });

    await waitForRouteIndex(page, 1);
    await expect(page).toHaveURL(/\/play$/);
  });

  test("mid-transition screenshots show Play and Disks together", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    });
    await page.goto("/play");
    await waitForRouteIndex(page, 1);

    await swipeWithMidTransitionScreenshots(page, testInfo, {
      caseName: "play-to-disks",
      fromX: cx,
      fromY: cy,
      totalDx: -swipeLen,
      sourceSlot: "swipe-slot-play",
      targetSlot: "swipe-slot-disks",
    });

    await waitForRouteIndex(page, 2);
    await expect(page).toHaveURL(/\/disks$/);
  });

  test("mid-transition screenshots show Docs and Home together during wrap-around", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    });
    await page.goto("/docs");
    await waitForRouteIndex(page, 5);

    await swipeWithMidTransitionScreenshots(page, testInfo, {
      caseName: "docs-to-home",
      fromX: cx,
      fromY: cy,
      totalDx: -swipeLen,
      sourceSlot: "swipe-slot-docs",
      targetSlot: "swipe-slot-home",
    });

    await waitForRouteIndex(page, 0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("rapid consecutive swipes do not corrupt state", async ({ page }, testInfo) => {
    await page.goto("/");
    await waitForCommittedRouteIndex(page, 0);

    await swipe(page, cx, cy, cx - swipeLen, cy);
    await waitForCommittedRouteIndex(page, 1);

    await swipe(page, cx, cy, cx - swipeLen, cy);
    await waitForCommittedRouteIndex(page, 2);

    await swipe(page, cx, cy, cx - swipeLen, cy);
    await waitForCommittedRouteIndex(page, 3);

    await attachStepScreenshot(page, testInfo, "config-after-rapid-swipes");
    await expect(page).toHaveURL(/\/config$/);
    await expect(page.getByTestId("swipe-slot-config")).toHaveAttribute("data-slot-active", "true");
  });
});
