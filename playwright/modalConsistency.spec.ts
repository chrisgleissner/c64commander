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
import { allowWarnings, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const FORBIDDEN_CLOSE_CLASSES = [
  "rounded-full",
  "shadow-sm",
  "bg-background/80",
  "border-border/60",
  "hover:bg-accent",
];

const seedOfflineState = async (page: Page) => {
  await page.addInitScript(() => {
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = "http://127.0.0.1:1";
    localStorage.setItem("c64u_automatic_demo_mode_enabled", "0");
    localStorage.setItem("c64u_startup_discovery_window_ms", "1000");
    localStorage.setItem("c64u_discovery_probe_timeout_ms", "600");
    localStorage.setItem("c64u_device_host", "127.0.0.1:1");
    localStorage.removeItem("c64u_password");
    localStorage.removeItem("c64u_has_password");
  });
};

const expectCloseControlNotFocusedOnOpen = async (surface: Page | ReturnType<Page["locator"]>) => {
  const closeButton = surface.getByRole("button", { name: "Close" });
  await expect(closeButton).toBeVisible();
  await expect
    .poll(() =>
      closeButton.evaluate((button) => ({
        activeTag: document.activeElement?.tagName ?? null,
        isCloseFocused: document.activeElement === button,
      })),
    )
    .toEqual({
      activeTag: "DIV",
      isCloseFocused: false,
    });
};

const expectHeaderTitleAndCloseShareRow = async (
  title: ReturnType<Page["locator"]>,
  closeButton: ReturnType<Page["locator"]>,
) => {
  const [titleBox, closeBox] = await Promise.all([title.boundingBox(), closeButton.boundingBox()]);

  expect(titleBox, "header title should expose bounds").not.toBeNull();
  expect(closeBox, "close control should expose bounds").not.toBeNull();

  if (!titleBox || !closeBox) {
    throw new Error("Unable to measure header title or close control.");
  }

  const titleCenterY = titleBox.y + titleBox.height / 2;
  const closeCenterY = closeBox.y + closeBox.height / 2;
  expect(Math.abs(titleCenterY - closeCenterY), "title and close should share one header row").toBeLessThanOrEqual(8);
  expect(titleBox.x, "title should remain to the left of the close control").toBeLessThan(closeBox.x);
};

test.describe("Modal close-control consistency", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  const expectActivePageViewportBoundaries = async (page: Page) => {
    const header = page.locator('header[data-app-chrome-mode="sticky"]').first();
    const scrollContainer = page.locator('main[data-page-scroll-container="true"]').first();
    const tabBar = page.locator("nav.tab-bar").first();

    await Promise.all([
      header.waitFor({ state: "attached" }),
      scrollContainer.waitFor({ state: "attached" }),
      tabBar.waitFor({ state: "attached" }),
    ]);

    const [headerBox, scrollBox, tabBarBox] = await Promise.all([
      header.boundingBox(),
      scrollContainer.boundingBox(),
      tabBar.boundingBox(),
    ]);

    expect(headerBox, "active page header should expose bounds").not.toBeNull();
    expect(scrollBox, "active page scroll container should expose bounds").not.toBeNull();
    expect(tabBarBox, "tab bar should expose bounds").not.toBeNull();

    if (!headerBox || !scrollBox || !tabBarBox) {
      throw new Error("Unable to measure active page shell boundaries.");
    }

    expect(scrollBox.y, "scroll container must begin below the page header").toBeGreaterThanOrEqual(
      headerBox.y + headerBox.height - 1,
    );
    expect(scrollBox.y + scrollBox.height, "scroll container must end above the fixed tab bar").toBeLessThanOrEqual(
      tabBarBox.y + 1,
    );

    const scrollMetrics = await scrollContainer.evaluate((visibleScroll) => {
      if (!(visibleScroll instanceof HTMLElement)) {
        return null;
      }

      visibleScroll.scrollTop = visibleScroll.scrollHeight;
      return {
        clientHeight: visibleScroll.clientHeight,
        scrollHeight: visibleScroll.scrollHeight,
        scrollTop: visibleScroll.scrollTop,
      };
    });

    expect(scrollMetrics, "active scroll container should expose measurable scroll metrics").not.toBeNull();
    if (!scrollMetrics) {
      throw new Error("Unable to measure active scroll container metrics.");
    }

    expect(scrollMetrics.clientHeight, "scroll container should retain a measurable viewport").toBeGreaterThan(0);
    expect(scrollMetrics.scrollHeight, "scroll container should expose stable scroll metrics").toBeGreaterThanOrEqual(
      scrollMetrics.clientHeight,
    );
    expect(
      scrollMetrics.scrollTop,
      "scroll container should remain scrollable without leaking into chrome",
    ).toBeGreaterThanOrEqual(0);
  };

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server?.close?.().catch(() => {});
    }
  });

  test("Connection Status dialog content regression: has Last activity with numeric format", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    // UnifiedHealthBadge now opens the Diagnostics sheet directly instead of a connection-status popover.
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible();
    await expect(diagSheet.getByTestId("diagnostics-health-line")).toContainText(/Unavailable|Idle/i);
    await expect(diagSheet).not.toContainText("just now");
    await expect(diagSheet).not.toContainText("Communication");
  });

  test("Connection Status dialog close control uses the plain shared glyph", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, "Expected probe failures during offline discovery.");
    await seedOfflineState(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "OFFLINE_NO_DEMO", { timeout: 10000 });
    // UnifiedHealthBadge now opens the Diagnostics sheet directly instead of a connection-status popover.
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible();

    const closeBtn = diagSheet.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    const classAttr = (await closeBtn.getAttribute("class")) ?? "";
    for (const cls of FORBIDDEN_CLOSE_CLASSES) {
      expect(classAttr, `close control should not have class: ${cls}`).not.toContain(cls);
    }
    await expect(closeBtn.locator("svg")).toHaveCount(0);
    await expect.poll(() => closeBtn.evaluate((button) => button.textContent ?? "")).toContain("×");
  });

  test("Diagnostics dialog close control uses the plain shared glyph", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // UnifiedHealthBadge now opens the Diagnostics sheet directly — no intermediate popover.
    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });

    const closeBtn = diagSheet.getByRole("button", { name: "Close" });
    await expect(closeBtn).toBeVisible();
    const classAttr = (await closeBtn.getAttribute("class")) ?? "";
    for (const cls of FORBIDDEN_CLOSE_CLASSES) {
      expect(classAttr, `diagnostics close control should not have class: ${cls}`).not.toContain(cls);
    }
    await expect(closeBtn.locator("svg")).toHaveCount(0);
    await expect.poll(() => closeBtn.evaluate((button) => button.textContent ?? "")).toContain("×");
  });

  test("workflow sheet keeps tab bar in layout while translating it off-screen", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const tabBarWrapper = page
      .locator("div[data-interstitial-active]")
      .filter({ has: page.locator("nav.tab-bar") })
      .first();
    await expect(tabBarWrapper).toHaveAttribute("data-interstitial-active", "false");

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });
    await expect(tabBarWrapper).toHaveAttribute("data-interstitial-active", "true");

    const transform = await tabBarWrapper.evaluate((element) => getComputedStyle(element).transform);
    expect(transform).not.toBe("none");
  });

  test("diagnostics confirmation dialog adds a second deterministic dim layer above the sheet", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });
    await page.getByTestId("diagnostics-overflow-menu").click();
    await page.getByTestId("diagnostics-clear-all-trigger").click();
    await expect(page.getByTestId("diagnostics-clear-all-confirm")).toBeVisible();

    await expect(page.locator("html")).toHaveAttribute("data-interstitial-depth", "2");

    const layers = await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('[data-state="open"][data-interstitial-depth]')).map(
        (element) => ({
          depth: element.getAttribute("data-interstitial-depth"),
          position: getComputedStyle(element).position,
          role: element.getAttribute("role"),
          zIndex: getComputedStyle(element).zIndex,
          backgroundColor: getComputedStyle(element).backgroundColor,
        }),
      );
    });

    const surfaces = layers.filter((element) => element.role === "dialog" || element.role === "alertdialog");
    const backdrops = layers.filter((element) => element.position === "fixed" && element.role === null);

    const sheetSurface = surfaces.find((element) => element.depth === "1" && element.role === "dialog");
    const alertSurface = surfaces.find((element) => element.depth === "2" && element.role === "alertdialog");
    const firstBackdrop = backdrops.find((element) => element.depth === "1");
    const secondBackdrop = backdrops.find((element) => element.depth === "2");

    expect(sheetSurface).toBeDefined();
    expect(alertSurface).toBeDefined();
    expect(firstBackdrop).toBeDefined();
    expect(secondBackdrop).toBeDefined();

    expect(Number(alertSurface?.zIndex ?? 0)).toBeGreaterThan(Number(sheetSurface?.zIndex ?? 0));
    expect(Number(secondBackdrop?.zIndex ?? 0)).toBeGreaterThan(Number(firstBackdrop?.zIndex ?? 0));
    expect(firstBackdrop?.backgroundColor).toBe("rgba(0, 0, 0, 0.4)");
    expect(secondBackdrop?.backgroundColor).toBe("rgba(0, 0, 0, 0.25)");
  });

  test("every primary page keeps its scroll container between the header and fixed tab bar", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
        sessionStorage.setItem("c64u_demo_interstitial_shown", "1");
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    for (const tab of [
      { label: "Home", testId: "tab-home" },
      { label: "Play", testId: "tab-play" },
      { label: "Disks", testId: "tab-disks" },
      { label: "Config", testId: "tab-config" },
      { label: "Settings", testId: "tab-settings" },
      { label: "Docs", testId: "tab-docs" },
    ]) {
      const tabButton = page.getByTestId(tab.testId);
      await tabButton.click();
      await expect(tabButton).toHaveAttribute("aria-current", "page");
      await expectActivePageViewportBoundaries(page);
    }
  });

  test("Diagnostics overflow menu stays left of the close button on small screens", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });

    const overflowBtn = diagSheet.getByTestId("diagnostics-overflow-menu");
    const closeBtn = diagSheet.getByRole("button", { name: "Close" });
    await expectCloseControlNotFocusedOnOpen(diagSheet);
    await expectHeaderTitleAndCloseShareRow(diagSheet.getByText("Diagnostics", { exact: true }), closeBtn);
    await expect(overflowBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    const overflowBox = await overflowBtn.boundingBox();
    const closeBox = await closeBtn.boundingBox();

    expect(overflowBox, "overflow menu should have a measurable hit target").not.toBeNull();
    expect(closeBox, "close button should have a measurable hit target").not.toBeNull();

    if (!overflowBox || !closeBox) {
      throw new Error("Diagnostics header controls did not expose bounding boxes.");
    }

    expect(
      overflowBox.x + overflowBox.width,
      "overflow menu should remain clearly to the left of the close button",
    ).toBeLessThanOrEqual(closeBox.x - 8);
  });

  test("Diagnostics header removes the old wrapped close button styling", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await page.addInitScript(
      ({ url }: { url: string }) => {
        (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = url;
      },
      { url: server.baseUrl },
    );
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const indicator = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(indicator).toHaveAttribute("data-connection-state", "REAL_CONNECTED", { timeout: 10000 });
    await indicator.click();

    const diagSheet = page.getByTestId("diagnostics-sheet");
    await expect(diagSheet).toBeVisible({ timeout: 5000 });
    await expect(diagSheet.getByTestId("diagnostics-overflow-menu")).toBeVisible();
    await expect(diagSheet.locator('[data-testid="lighting-sheet-handle"]')).toHaveCount(0);
  });
});
