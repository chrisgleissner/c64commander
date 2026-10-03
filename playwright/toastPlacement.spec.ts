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
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS, DISPLAY_PROFILE_VIEWPORT_SEQUENCE } from "./displayProfileViewports";

/**
 * An error toast stays until the user closes it, so wherever it sits it must not cover a control.
 * Floating below the app bar it covered Play's "Stop radio" button on the Pixel 4, and a tap aimed
 * at the button landed on the toast instead.
 *
 * For every control whose center lies inside a toast, `elementFromPoint` at that center has to
 * return the control itself. That is checked with each page scrolled to its top and to its bottom.
 */

const ERROR_TITLE = "Machine action failed";
const MIN_TARGET_PX = 44;

type Covered = { control: string; hit: string; x: number; y: number };
type HitTestResult = { toasts: number; controls: number; underToast: number; covered: Covered[] };

const hitTestControlsUnderToasts = (page: Page) =>
  page.evaluate((): HitTestResult => {
    const describe = (element: Element | null) => {
      if (!element) return "nothing";
      const named = element.closest("[data-testid]");
      const label = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30) ?? "";
      return `${element.tagName.toLowerCase()}${named ? `[${named.getAttribute("data-testid")}]` : ""} "${label}"`;
    };
    const toastRects = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="app-toast"][data-state="open"]'),
    ).map((toast) => toast.getBoundingClientRect());
    const selector =
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="slider"], [role="checkbox"]';
    const covered: Covered[] = [];
    let controls = 0;
    let underToast = 0;
    for (const control of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (control.closest('[data-testid="app-toast"]')) continue;
      const style = window.getComputedStyle(control);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = control.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      controls += 1;
      const inToast = toastRects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      if (!inToast) continue;
      // A control scrolled out of its own clipping scroll box is not on screen, toast or no toast.
      let clipped = false;
      for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const overflowY = window.getComputedStyle(ancestor).overflowY;
        if (overflowY === "visible") continue;
        const box = ancestor.getBoundingClientRect();
        if (y < box.top || y > box.bottom || x < box.left || x > box.right) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      underToast += 1;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === control || control.contains(hit))) continue;
      covered.push({ control: describe(control), hit: describe(hit), x: Math.round(x), y: Math.round(y) });
    }
    return { toasts: toastRects.length, controls, underToast, covered };
  });

const scrollPages = (page: Page, to: "top" | "bottom") =>
  page.evaluate((edge) => {
    for (const scroller of Array.from(document.querySelectorAll<HTMLElement>("[data-page-scroll-container]"))) {
      scroller.scrollTop = edge === "top" ? 0 : scroller.scrollHeight;
    }
  }, to);

const expectNoControlUnderToast = async (page: Page, where: string) => {
  for (const edge of ["top", "bottom"] as const) {
    await scrollPages(page, edge);
    await page.waitForTimeout(150);
    const result = await hitTestControlsUnderToasts(page);
    expect(result.toasts, `${where}: the error toast must be showing`).toBeGreaterThan(0);
    expect(result.controls, `${where}: the page rendered no controls to test`).toBeGreaterThan(5);
    expect(
      result.covered,
      `${where} (scrolled to ${edge}): controls covered by the toast:\n` +
        result.covered.map((c) => `  ${c.control} at ${c.x},${c.y} hits ${c.hit}`).join("\n"),
    ).toEqual([]);
  }
};

const openTab = async (page: Page, label: string, path: string) => {
  await page.getByTestId("tab-bar").getByRole("button", { name: label, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}`));
  await page.waitForTimeout(600);
};

test.describe("Persistent error toast placement", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async () => {
    await server.close();
  });

  for (const profileId of DISPLAY_PROFILE_VIEWPORT_SEQUENCE) {
    const profile = DISPLAY_PROFILE_VIEWPORTS[profileId];

    test(`an error toast covers no control on Home, Play and Settings (${profileId} ${profile.viewport.width}x${profile.viewport.height}) @layout`, async ({
      page,
    }, testInfo) => {
      disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
      server = await createMockC64Server();
      await seedUiMocks(page, server.baseUrl);
      await page.addInitScript((override) => {
        localStorage.setItem("c64u_display_profile_override", override);
      }, profile.override);
      await page.setViewportSize(profile.viewport);
      await page.route("**/v1/machine:pause**", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: '{"errors":["pause refused"]}' }),
      );

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (expected) => document.documentElement.dataset.displayProfile === expected,
        profile.expectedProfile,
      );
      await page.getByTestId("tab-bar").waitFor({ state: "visible", timeout: 30_000 });

      await page.getByTestId("home-machine-controls").getByRole("button", { name: "Pause", exact: true }).click();
      const toast = page.locator('[data-testid="app-toast"][data-state="open"]').filter({ hasText: ERROR_TITLE });
      await expect(toast).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);

      await expectNoControlUnderToast(page, "Home");
      await openTab(page, "Play", "/play");
      await expect(toast).toBeVisible();
      await expectNoControlUnderToast(page, "Play");
      await testInfo.attach(`play-with-error-toast-${profileId}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await openTab(page, "Settings", "/settings");
      await expect(toast).toBeVisible();
      await expectNoControlUnderToast(page, "Settings");

      const close = toast.getByTestId("app-toast-close");
      const details = toast.getByTestId("app-toast-details");
      for (const button of [close, details]) {
        const box = await button.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      }
      for (const text of [toast.getByTestId("app-toast-title"), toast.getByTestId("app-toast-description")]) {
        const fontPx = await text.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
        expect(fontPx).toBeGreaterThanOrEqual(16);
      }

      await close.click();
      await expect(toast).toHaveCount(0);
      await expect(page.getByTestId("diagnostics-dialog")).toHaveCount(0);
    });
  }

  test("two long error toasts on the smallest screen leave the page a usable area and cover no control @layout", async ({
    page,
  }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    const profile = DISPLAY_PROFILE_VIEWPORTS.compact;
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript((override) => {
      localStorage.setItem("c64u_display_profile_override", override);
    }, profile.override);
    await page.setViewportSize(profile.viewport);
    const longError = JSON.stringify({
      errors: ["The device refused the request because another client holds the machine; try again in a moment."],
    });
    for (const action of ["pause", "menu_button"]) {
      await page.route(`**/v1/machine:${action}**`, (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: longError }),
      );
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.displayProfile === expected,
      profile.expectedProfile,
    );
    await page.getByTestId("tab-bar").waitFor({ state: "visible", timeout: 30_000 });
    const controls = page.getByTestId("home-machine-controls");
    const openToasts = page.locator('[data-testid="app-toast"][data-state="open"]');
    await controls.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(openToasts).toHaveCount(1, { timeout: 20_000 });
    await controls.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(openToasts).toHaveCount(2, { timeout: 20_000 });
    await page.waitForTimeout(400);

    const pageAreaPx = await page
      .getByTestId("swipe-navigation-container")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(pageAreaPx, "page area left between the toasts and the top of the screen").toBeGreaterThanOrEqual(
      profile.viewport.height / 3,
    );
    await expectNoControlUnderToast(page, "Home with two error toasts");
  });
});

type Rect = { top: number; bottom: number; left: number; right: number };

const stripRect = (page: Page) =>
  page.locator(".toast-viewport").evaluate((el): Rect => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

test.describe("Toast strip touch scrolling", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async () => {
    await server?.close();
  });

  test("a clipped second error toast can be scrolled into view by touch and closed with a tap on the smallest screen", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "Needs a touch-enabled context.");
    disableTraceAssertions(testInfo, "Touch-scroll coverage; trace assertions disabled.");
    const profile = DISPLAY_PROFILE_VIEWPORTS.compact;
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript((override) => {
      localStorage.setItem("c64u_display_profile_override", override);
    }, profile.override);
    await page.setViewportSize(profile.viewport);
    const longError = JSON.stringify({
      errors: ["The device refused the request because another client holds the machine; try again in a moment."],
    });
    for (const action of ["pause", "menu_button"]) {
      await page.route(`**/v1/machine:${action}**`, (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: longError }),
      );
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (expected) => document.documentElement.dataset.displayProfile === expected,
      profile.expectedProfile,
    );
    await page.getByTestId("tab-bar").waitFor({ state: "visible", timeout: 30_000 });
    const controls = page.getByTestId("home-machine-controls");
    const openToasts = page.locator('[data-testid="app-toast"][data-state="open"]');
    await controls.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(openToasts).toHaveCount(1, { timeout: 20_000 });
    await controls.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(openToasts).toHaveCount(2, { timeout: 20_000 });
    await page.waitForTimeout(600);

    const strip = await stripRect(page);
    const closeRects = await openToasts.evaluateAll((toasts) =>
      toasts.map((toast) => {
        const r = toast.querySelector('[data-testid="app-toast-close"]')!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }),
    );
    const clippedIndex = closeRects.findIndex((r) => r.top < strip.top || r.bottom > strip.bottom);
    expect(clippedIndex, "one toast's close button must start outside the strip").toBeGreaterThanOrEqual(0);
    const clippedClose = openToasts.nth(clippedIndex).getByTestId("app-toast-close");
    const scrollDown = closeRects[clippedIndex].bottom > strip.bottom;

    const cdp = await page.context().newCDPSession(page);
    const fingerX = Math.round((strip.left + strip.right) / 2);
    const closeInStrip = async () => {
      const box = await clippedClose.boundingBox();
      const now = await stripRect(page);
      return box !== null && box.y >= now.top && box.y + box.height <= now.bottom;
    };
    for (let attempt = 0; attempt < 6 && !(await closeInStrip()); attempt += 1) {
      const now = await stripRect(page);
      const from = Math.round(scrollDown ? now.bottom - 12 : now.top + 12);
      const to = Math.round(scrollDown ? now.top + 12 : now.bottom - 12);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fingerX, y: from }] });
      const steps = 12;
      for (let step = 1; step <= steps; step += 1) {
        const y = Math.round(from + ((to - from) * step) / steps);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: fingerX, y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
    }
    expect(await closeInStrip(), "the clipped toast's close button must scroll into the strip by touch").toBe(true);

    const closeBox = (await clippedClose.boundingBox())!;
    await page.touchscreen.tap(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
    await expect(openToasts).toHaveCount(1);
    await expect(page.getByTestId("diagnostics-dialog")).toHaveCount(0);

    const remainingTitle = openToasts.first().getByTestId("app-toast-title");
    await remainingTitle.scrollIntoViewIfNeeded();
    const remaining = (await remainingTitle.boundingBox())!;
    const swipeY = Math.round(remaining.y + remaining.height / 2);
    const swipeFrom = Math.round(remaining.x + 8);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: swipeFrom, y: swipeY }] });
    for (let step = 1; step <= 10; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: swipeFrom + step * 15, y: swipeY }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(openToasts, "a horizontal swipe still dismisses a toast").toHaveCount(0);
  });
});
