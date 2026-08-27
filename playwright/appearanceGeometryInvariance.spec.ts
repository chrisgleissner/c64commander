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
 * Proves the claim spec.md section 10 calls "load-bearing": switching appearance style changes
 * zero geometry. Every other layout, ergonomics, overflow, clipping and target-size spec in this
 * suite runs on the default style only; they stay valid for all twelve palettes exactly because
 * this spec exists and passes. See smallScreenErgonomics.spec.ts:39-41 for the cross-reference in
 * the other direction, and docs/plans/appearance-styles/plan.md section "Phase 7" for why this was
 * written before the Phase 2 radius/shadow/edge sweep rather than after it: it is the regression
 * net that sweep runs against, not a report card on it afterwards.
 *
 * Method: capture a baseline of every visible [data-testid] element's getBoundingClientRect() with
 * no data-app-style attribute set (today's un-styled default), then, without reloading, set
 * data-app-style and toggle the .dark class directly for each of the 12 generated palettes in
 * turn, re-snapshotting after each. Equality is exact - no tolerance - because a style is only
 * permitted to touch colour, corner radius, edge treatment, elevation and the focus-ring
 * treatment's rendering (spec.md section 5, decision D2), none of which spec.md decision D10
 * allows to move a box: radius and shadow are paint-only, and the edge is always an inset
 * box-shadow or outline, never border-width. If this test goes red, the fix is to find the token
 * that moved a box, not to add a tolerance (docs/plans/appearance-styles/prompt.md, "When you are
 * unsure").
 */

type Snapshot = Record<string, { x: number; y: number; width: number; height: number }>;

/**
 * Bounding rects for every visible [data-testid], keyed by "testid#n" (n = occurrence index in DOM
 * order) so repeated testids in a list disambiguate the same way on every capture, as long as
 * nothing is added, removed or reordered between captures - true here, since only CSS custom
 * properties change.
 *
 * The hidden-subtree predicate is copied from playwright/smallScreenLayoutAudit.ts's
 * isHiddenSurface (lines ~107-127 there): it runs inside page.evaluate, so it cannot be imported
 * across the Node/browser boundary and is duplicated here rather than shared, the same way every
 * other page.evaluate-based spec in this suite keeps its own copy.
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
 * still-running CSS transition leaves behind between one capture and the next. Mirrors the
 * determinism steps `screenshots.spec.ts`'s `waitForStableRender` already established are
 * necessary (readyState, networkidle, fonts, no running animations, a few settled frames) -
 * duplicated rather than imported, per that file's own "leave exactly as it is" status in
 * plan.md's Phase 7 (every layout-audit spec in this suite keeps its own local copy of small
 * page.evaluate-scoped helpers, since they cannot cross the Node/browser boundary). One fix on
 * top of that precedent: `document.fonts.ready` is a Promise, so it must be returned from
 * page.evaluate and actually awaited, not read as a value inside waitForFunction, where a Promise
 * reference is truthy on the very first poll and the wait becomes a no-op.
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
