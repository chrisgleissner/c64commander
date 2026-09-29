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
import { TOUR_STEPS } from "../src/lib/tour/steps";

/**
 * The tour on a REAL first launch.
 *
 * seedUiMocks records the tour as already taken, because otherwise its full-screen overlay covers
 * the page every other walk is there to drive. This spec clears that key again, which is the only
 * place the first-launch behaviour is exercised end to end.
 */

/*
 * Make the NEXT load a first launch, and only that one.
 *
 * addInitScript runs on every navigation, so an unconditional remove would also wipe the record a
 * reload is there to check — the tour would reopen and the test would report a defect that is its
 * own. sessionStorage survives a reload in the same tab, so it is what marks "already done".
 */
const clearTourState = async (page: Page) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("__tourStateClearedOnce") === "1") return;
    sessionStorage.setItem("__tourStateClearedOnce", "1");
    localStorage.removeItem("c64u_tour_state:v1");
    // The app declines to offer the tour to an installation that has been used before, and this
    // harness seeds a device and a mock server before the app loads, which is indistinguishable
    // from prior use. This key says "treat storage as empty" for that one decision.
    localStorage.setItem("c64u_e2e_first_launch", "1");
  });
};

test.describe("first-run tour", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "A first-launch walkthrough; no traced user journey.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await clearTourState(page);
    await page.setViewportSize({ width: 393, height: 727 });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("opens on a first launch, walks every step, and never opens again", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tour-progress")).toHaveAttribute("data-step", "1");

    for (let index = 1; index < TOUR_STEPS.length; index += 1) {
      await page.getByTestId("tour-next").click();
      await expect(page.getByTestId("tour-progress")).toHaveAttribute("data-step", String(index + 1));
      // Every step either spotlights something or says so; neither is a blank screen.
      await expect(page.getByTestId("tour-caption")).toBeVisible();
    }

    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();

    // A reload must not bring it back: it was completed.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  });

  /*
   * The buttons sit above the system bar, not under it.
   *
   * The panel is pinned to the bottom edge, which on a handset with gesture navigation is where
   * the system bar is. Without the inset the Skip, Back and Next row was drawn underneath it: on
   * the device the row was half covered and hard to hit. The inset is a CSS variable the native
   * layer writes, so the test writes it too.
   */
  /*
   * Every anchored step finds what it points at.
   *
   * A step whose anchors never appear degrades to a caption with no spotlight, which is the right
   * behaviour and an easy way to not notice that a test id was renamed. This asserts the spotlight
   * is drawn for each step that declares one, so a broken anchor fails rather than degrading
   * quietly. The mock device is connected, so the steps that need a machine are covered too.
   */
  test("spotlights something on every step that points at the app", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });

    for (const [index, step] of TOUR_STEPS.entries()) {
      if (index > 0) {
        await page.getByTestId("tour-next").click();
        await expect(page.getByTestId("tour-progress")).toHaveAttribute("data-step", String(index + 1));
      }
      await expect(page.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", step.id);
      if (step.anchor === undefined) continue;
      await expect(
        page.getByTestId("tour-spotlight"),
        `step "${step.id}" points at ${step.anchor.testIds.join(", ")} and must spotlight it`,
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("keeps its buttons clear of the bottom system bar", async ({ page }) => {
    const inset = 48;
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tour-caption")).toHaveAttribute("data-placement", "bottom");
    // Set inline on the root, which is where Capacitor's SystemBars plugin writes the real
    // insets on Android and so beats the env() fallback declared on :root. The app no longer
    // keeps a second copy of these under its own name for the layout to compose with.
    await page.evaluate((value: number) => {
      document.documentElement.style.setProperty("--safe-area-inset-bottom", `${value}px`);
    }, inset);
    await page.waitForTimeout(200);

    const viewportHeight = page.viewportSize()!.height;
    for (const testId of ["tour-skip", "tour-back", "tour-next"]) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box, `${testId} must be laid out`).not.toBeNull();
      expect(box!.y + box!.height, `${testId} must sit above the ${inset}px system bar`).toBeLessThanOrEqual(
        viewportHeight - inset,
      );
    }
  });

  /*
   * In landscape Android puts its navigation bar down the right-hand side. On a Pixel 4 at the
   * smallest supported geometry turned sideways, it covered the right third of Next.
   */
  test("keeps its buttons clear of a navigation bar down the side in landscape", async ({ page }) => {
    const inset = 48;
    await page.setViewportSize({ width: 427, height: 320 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.evaluate((value: number) => {
      document.documentElement.style.setProperty("--safe-area-inset-right", `${value}px`);
    }, inset);
    await page.waitForTimeout(200);

    const box = await page.getByTestId("tour-next").boundingBox();
    expect(box, "tour-next must be laid out").not.toBeNull();
    expect(box!.x + box!.width, `tour-next must sit left of the ${inset}px bar`).toBeLessThanOrEqual(427 - inset);
  });

  test("spotlights the Home search field on the step that is about search", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tour-next").click();

    await expect(page.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", "search");
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();

    const spotlight = await page.getByTestId("tour-spotlight").boundingBox();
    const field = await page.getByTestId("home-search-field").boundingBox();
    expect(spotlight).not.toBeNull();
    expect(field).not.toBeNull();
    // The hole encloses the field it is pointing at, with its padding.
    expect(spotlight!.y).toBeLessThanOrEqual(field!.y);
    expect(spotlight!.y + spotlight!.height).toBeGreaterThanOrEqual(field!.y + field!.height);
  });

  test("can be skipped at any step, and does not come back", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tour-next").click();
    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("tour-overlay")).toHaveCount(0);
  });

  test("is restartable from the card at the top of Docs", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();

    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
    // The card animates in, so wait for it to settle rather than clicking a node about to be
    // replaced — the first version of this failed with "element was detached from the DOM".
    await expect(page.getByTestId("docs-tour-start")).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByTestId("docs-tour-start").click();
    await expect(page.getByTestId("tour-overlay")).toBeVisible();
    await expect(page.getByTestId("tour-progress")).toHaveAttribute("data-step", "1");
  });

  /*
   * The smallest supported screen, driven by keys alone, measuring what the caption leaves.
   *
   * Measured on a Pixel 4 at this geometry, the old caption left 36% of the screen showing and on
   * three steps covered the very control it was describing. Every step must leave at least half of
   * the screen, and every spotlight must be in view rather than underneath the caption.
   */
  test("leaves half the smallest screen and the whole subject in view on every step, by keys alone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 426 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });

    for (const [index, step] of TOUR_STEPS.entries()) {
      if (index > 0) await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("tour-overlay")).toHaveAttribute("data-tour-step", step.id);
      if (step.anchor) await expect(page.getByTestId("tour-spotlight")).toBeVisible({ timeout: 10_000 });
      // The alignment re-checks the anchor twice within a second while the page settles.
      await page.waitForTimeout(1_200);

      const geometry = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        const caption = box('[data-testid="tour-caption"]')!;
        const hole = box('[data-testid="tour-spotlight"]');
        const atBottom = caption.top > window.innerHeight / 2;
        // What the caption leaves of the screen, and of the app's own area between the app bar and
        // the tab bar, which the tour dims but which are not what a step describes.
        const screenBand = atBottom
          ? { top: 0, bottom: caption.top }
          : { top: caption.bottom, bottom: window.innerHeight };
        const appTop = box('[data-testid="app-bar-row"]')?.bottom ?? 0;
        const appBottom = box('[data-testid="tab-bar"]')?.top ?? window.innerHeight;
        const appFree = Math.min(appBottom, screenBand.bottom) - Math.max(appTop, screenBand.top);
        const visible = hole
          ? Math.max(0, Math.min(hole.bottom, screenBand.bottom) - Math.max(hole.top, screenBand.top))
          : null;
        return {
          unobscured: Math.max(0, appFree) / (appBottom - appTop),
          visible,
          wanted: hole ? Math.min(hole.height, screenBand.bottom - screenBand.top) : null,
        };
      });
      expect(geometry.unobscured, `step "${step.id}" must leave half the app's area`).toBeGreaterThanOrEqual(0.5);
      if (geometry.visible !== null && geometry.wanted !== null) {
        expect(geometry.visible, `step "${step.id}" must not cover its own subject`).toBeGreaterThanOrEqual(
          geometry.wanted * 0.9,
        );
      }
    }

    // A held Right repeats. Playwright marks every `down` after the first as a repeat, which is what
    // a held key sends: one step forward, then nothing, and never past the last step into Done.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("tour-progress")).toHaveAttribute("data-step", String(TOUR_STEPS.length - 1));
    for (let repeat = 0; repeat < 6; repeat += 1) await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await expect(page.getByTestId("tour-progress")).toHaveAttribute("data-step", String(TOUR_STEPS.length));
    await page.waitForTimeout(300);
    await expect(page.getByTestId("tour-overlay")).toBeVisible();
  });

  test("folds its text on Down so more of the app shows, and brings it back on Up", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 426 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    const readHeight = (await page.getByTestId("tour-caption").boundingBox())!.height;

    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tour-caption")).toHaveAttribute("data-mode", "look");
    await expect(page.getByTestId("tour-body")).toHaveCount(0);
    const lookHeight = (await page.getByTestId("tour-caption").boundingBox())!.height;
    expect(lookHeight).toBeLessThan(readHeight);

    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("tour-body")).toBeVisible();
  });

  test("disables swipe navigation while it runs", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("c64u_enable_swipe_navigation", "1"));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-overlay")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "false");

    await page.getByTestId("tour-skip").click();
    await expect(page.getByTestId("tour-overlay")).toBeHidden();
    await expect(page.getByTestId("swipe-navigation-container")).toHaveAttribute("data-swipe-enabled", "true");
  });
});
