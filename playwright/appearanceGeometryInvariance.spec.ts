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
import { APP_STYLES, type AppStyleMode } from "../src/generated/appStyles";

/**
 * Proves spec.md section 10's load-bearing claim: switching appearance style changes zero
 * geometry. Every other layout, ergonomics and target-size spec runs on the default style only,
 * and stays valid for all twelve palettes because this one passes.
 *
 * Equality is exact, with no tolerance, because radius and shadow are paint-only and the edge is
 * an inset box-shadow, never border-width (decision D10). A red run means finding the token that
 * moved a box, not adding a tolerance.
 */

type Snapshot = Record<string, { x: number; y: number; width: number; height: number }>;

/**
 * Bounding rects for every visible [data-testid], keyed by "testid#n" (n = occurrence index in DOM
 * order) so repeated testids disambiguate identically on every capture. The hidden-subtree
 * predicate is a copy of smallScreenLayoutAudit.ts's isHiddenSurface: it runs inside
 * page.evaluate, so it cannot be imported across the Node/browser boundary.
 */
const captureTestIdRects = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const isRendered = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number.parseFloat(style.opacity) < 0.1) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const isVisuallyHidden = (element: Element): boolean => {
      let node: Element | null = element;
      for (let hops = 0; node && hops < 6; hops += 1) {
        const style = window.getComputedStyle(node);
        const clipped = style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
        if (clipped && style.position === "absolute") return true;
        node = node.parentElement;
      }
      return false;
    };

    const isHiddenSurface = (element: Element): boolean => {
      if (element.closest("[inert]")) return true;
      if (element.closest('[aria-hidden="true"]')) return true;
      if (element.closest("[hidden]")) return true;
      if (element.closest(".sr-only")) return true;
      if (isVisuallyHidden(element)) return true;
      return false;
    };

    const seen = new Map<string, number>();
    const snapshot: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const element of Array.from(document.querySelectorAll("[data-testid]"))) {
      if (isHiddenSurface(element)) continue;
      if (!isRendered(element)) continue;
      const testId = element.getAttribute("data-testid") ?? "";
      const occurrence = seen.get(testId) ?? 0;
      seen.set(testId, occurrence + 1);
      const rect = element.getBoundingClientRect();
      snapshot[`${testId}#${occurrence}`] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return snapshot;
  });

const applyPalette = (page: Page, styleId: string, mode: AppStyleMode) =>
  page.evaluate(
    ({ styleId: id, mode: appliedMode }) => {
      document.documentElement.setAttribute("data-app-style", id);
      document.documentElement.classList.toggle("dark", appliedMode === "dark");
    },
    { styleId, mode },
  );

const clearPalette = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.removeAttribute("data-app-style");
    document.documentElement.classList.remove("dark");
  });

/** Every generated palette as a flat (styleId, mode) list — 12 entries, per spec.md section 6. */
const PALETTES: ReadonlyArray<{ styleId: string; mode: AppStyleMode }> = APP_STYLES.flatMap((style) =>
  (["light", "dark"] as const).filter((mode) => style[mode] !== undefined).map((mode) => ({ styleId: style.id, mode })),
);

const ROUTES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/", label: "Home" },
  { path: "/settings", label: "Settings" },
];

/** compact and medium, per spec.md section 10. */
const VIEWPORTS: ReadonlyArray<{ label: string; width: number; height: number }> = [
  { label: "compact", width: 320, height: 426 },
  { label: "medium", width: 393, height: 727 },
];

/**
 * Exact pixel comparisons cannot tolerate the sub-pixel drift a still-swapping web font or a
 * running transition leaves between captures, so this mirrors screenshots.spec.ts's
 * waitForStableRender steps. `document.fonts.ready` is returned from page.evaluate and awaited:
 * read inside waitForFunction instead, the Promise reference is truthy on the first poll and the
 * wait becomes a no-op.
 */
const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => {
    const animations = document.getAnimations();
    return animations.every((animation) => {
      if (animation.playState !== "running") return true;
      const timing = animation.effect?.getComputedTiming();
      return timing?.iterations === Infinity;
    });
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

test.describe("Appearance style geometry invariance @layout", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; the page is never interacted with.");
    server = await createMockC64Server();
    void page;
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      test(`${route.label} at ${viewport.label}: all 12 palettes match the default style's geometry exactly`, async ({
        page,
      }) => {
        await seedUiMocks(page, server.baseUrl);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await settle(page);

        await clearPalette(page);
        const baseline = await captureTestIdRects(page);
        expect(Object.keys(baseline).length, "baseline must capture at least one element").toBeGreaterThan(0);

        for (const palette of PALETTES) {
          await applyPalette(page, palette.styleId, palette.mode);
          // A colour/token change never affects layout, but give the compositor one frame before
          // measuring anyway, matching the same margin the baseline capture gets.
          await page.evaluate(() => new Promise(requestAnimationFrame));
          const snapshot = await captureTestIdRects(page);
          expect(
            Object.keys(snapshot),
            `${route.label}/${viewport.label}/${palette.styleId} (${palette.mode}): same set of visible testids as baseline`,
          ).toEqual(Object.keys(baseline));
          expect(
            snapshot,
            `${route.label}/${viewport.label}/${palette.styleId} (${palette.mode}): exact geometry match against the baseline`,
          ).toEqual(baseline);
        }
      });
    }
  }
});
