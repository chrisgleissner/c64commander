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
});
