/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad } from "./focusRing";

/**
 * The playlist's letter rail and the scroll position indicator, on the smallest screen.
 *
 * The rail lets a long playlist be searched by letter with a finger or with keypad digits, and the
 * found item played at once. It used to be an overlay on the left edge whose invisible touch strip
 * covered the start of every row, including its selection checkbox. The indicator shows where the
 * viewport is in a page, sheet or dialog that scrolls.
 */

const PLAYLIST_SIZE = 2_700;
const WORDS = [
  "1942",
  "Arkanoid",
  "Bubble",
  "Commando",
  "Delta",
  "Elite",
  "Flimbo",
  "Giana",
  "Hawkeye",
  "Ikari",
  "Jet",
  "Katakis",
  "Last",
  "Monty",
  "Nemesis",
  "Outrun",
  "Paradroid",
  "Quedex",
  "Rambo",
  "Sanxion",
  "Thrust",
  "Ultima",
  "Vendetta",
  "Wizball",
  "Xenon",
  "Yie",
  "Zoids",
];

/** A long playlist sorted by name, so the first item of each letter is known. */
const seedLongPlaylist = (page: Page) =>
  page.addInitScript(
    ({ size, words }) => {
      const items = Array.from({ length: size }, (_, index) => {
        const name = `${words[index % words.length]}_Theme_${String(index).padStart(4, "0")}.sid`;
        return {
          source: "ultimate",
          path: `/Usb0/HVSC/${name}`,
          name,
          durationMs: 120_000,
          songNr: 1,
          sourceId: null,
        };
      }).sort((left, right) => left.name.localeCompare(right.name));
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify({ items, currentIndex: -1 }));
    },
    { size: PLAYLIST_SIZE, words: WORDS },
  );

/** The first title, in playlist order, that the row for `word` shows. */
const firstTitleOf = (word: string) => {
  const indices = Array.from({ length: PLAYLIST_SIZE }, (_, index) => index).filter(
    (index) => WORDS[index % WORDS.length] === word,
  );
  const names = indices.map((index) => `${word}_Theme_${String(index).padStart(4, "0")}`).sort();
  return names[0].replace(/_/g, " ");
};

const observeLongTasks = (page: Page) =>
  page.addInitScript(() => {
    const tasks: number[] = [];
    Object.assign(window, { __longTasks: tasks });
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => tasks.push(entry.duration))).observe({
      type: "longtask",
      buffered: true,
    });
  });

const longTaskCount = (page: Page) => page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);

const scroller = (page: Page) => page.locator('[data-virtuoso-scroller="true"]');

/** Sheets open with a slide, so a box measured mid-animation is not where it settles. */
const waitForAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );

const openPlaylistSheet = async (page: Page) => {
  await page.goto("/play", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  await page.getByRole("button", { name: "View all" }).click();
  await expect(page.getByTestId("alphabet-rail")).toBeVisible({ timeout: 15_000 });
  await expect(scroller(page).locator('[data-row-title="true"]').first()).toBeVisible();
  await waitForAnimations(page);
};

/** The title of the row at the top of the list, which is where a jump puts the letter's first item. */
const topRowTitle = (page: Page) =>
  scroller(page).evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const rows = [...node.querySelectorAll("[data-row-id]")].filter((row) => row.querySelector("[data-row-title]"));
    const first = rows.find((row) => row.getBoundingClientRect().bottom > top + 1);
    return first?.querySelector("[data-row-title]")?.firstElementChild?.textContent?.trim() ?? null;
  });

const focusedTitle = (page: Page) =>
  page.evaluate(() =>
    document.activeElement?.getAttribute("data-row-title") === "true"
      ? (document.activeElement.firstElementChild?.textContent?.trim() ?? null)
      : null,
  );

const playingTitle = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('[data-virtuoso-scroller="true"] [data-playing="true"] [data-row-title]')
        ?.firstElementChild?.textContent?.trim() ?? null,
  );

/**
 * Drags along the rail from its top to the band of `letter`, as a finger would. The rail reads
 * letters against where it was when the finger went down, even when a jump then folds the sheet's
 * filter or ends keypad mode and the rail grows.
 */
const dragRailTo = async (page: Page, letter: string, letters: readonly string[]) => {
  const box = await page.getByTestId("alphabet-rail").boundingBox();
  if (!box) throw new Error("The letter rail has no box");
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + ((letters.indexOf(letter) + 0.5) / letters.length) * box.height, { steps: 8 });
  await page.mouse.up();
};

const RAIL_LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

const overlapArea = (a: { x: number; y: number; width: number; height: number }, b: DOMRect) =>
  Math.max(0, Math.min(a.x + a.width, b.right) - Math.max(a.x, b.left)) *
  Math.max(0, Math.min(a.y + a.height, b.bottom) - Math.max(a.y, b.top));

const indicator = (page: Page, within?: Locator) =>
  (within ?? page.locator("body")).locator('[data-testid="scroll-position-indicator"]');

test.describe("List navigation affordances on the smallest screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout and navigation coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await observeLongTasks(page);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("the letter rail covers no part of any row @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await openPlaylistSheet(page);
    const rail = await page.getByTestId("alphabet-rail").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });

    const rows = await scroller(page).evaluate((node) =>
      [...node.querySelectorAll("[data-row-id]")].map((row) => {
        const title = row.querySelector("[data-row-title]");
        const range = document.createRange();
        if (title?.firstChild) range.selectNodeContents(title);
        const glyph = title ? range.getClientRects()[0] : null;
        const controls = [...row.querySelectorAll("button, label")].map((control) => {
          const rect = control.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        return {
          right: row.getBoundingClientRect().right,
          firstGlyphLeft: glyph?.left ?? null,
          controls,
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.right, "a row reaches under the letter rail").toBeLessThanOrEqual(rail.left + 0.5);
      if (row.firstGlyphLeft !== null) expect(row.firstGlyphLeft).toBeLessThan(rail.left);
      for (const control of row.controls) expect(control.right).toBeLessThanOrEqual(rail.left + 0.5);
    }

    // What a finger lands on at the start and end of a row is the row's own control. The previous
    // rail's touch strip lay over the left edge, so a tap on a row's selection box reached the strip.
    const hits = await scroller(page).evaluate(async (node) => {
      const label = node.querySelector("[data-row-id] label");
      if (!label) return [];
      node.scrollTop += label.getBoundingClientRect().top - node.getBoundingClientRect().top - 8;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const view = node.getBoundingClientRect();
      return [...node.querySelectorAll("[data-row-id] label, [data-row-id] button")]
        .map((control) => ({ control, rect: control.getBoundingClientRect() }))
        .filter(({ rect }) => rect.top >= view.top && rect.bottom <= view.bottom)
        .map(({ control, rect }) => {
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            name: control.getAttribute("aria-label") ?? control.tagName,
            ownHit: !!hit && control.contains(hit),
          };
        });
    });
    expect(hits.length, "no row control was on screen to hit-test").toBeGreaterThanOrEqual(3);
    for (const hit of hits) expect(hit.ownHit, `${hit.name} is covered`).toBe(true);
  });

  test("the letter rail stays clear of the folded filter row @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await openPlaylistSheet(page);
    await scroller(page).locator('[data-row-title="true"]').first().focus();
    await page.keyboard.press("m");
    await expect.poll(() => focusedTitle(page), { timeout: 15_000 }).toBe(firstTitleOf("Monty"));
    const toggle = page.getByTestId("view-all-filter-toggle");
    await expect(toggle).toBeVisible();
    await waitForAnimations(page);
    const railBox = await page.getByTestId("alphabet-rail").boundingBox();
    const toggleBox = await toggle.evaluate((node) => node.getBoundingClientRect());
    expect(railBox).not.toBeNull();
    expect(overlapArea(railBox!, toggleBox), "the rail lies over the folded filter row").toBe(0);
  });

  test("dragging the rail lands on the letter's first item and its play button plays it @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await openPlaylistSheet(page);

    await dragRailTo(page, "Q", RAIL_LETTERS);

    await expect(page.getByTestId("alphabet-badge")).toHaveText("Q");
    await expect.poll(() => topRowTitle(page), { timeout: 10_000 }).toBe(firstTitleOf("Quedex"));
    await expect.poll(() => focusedTitle(page)).toBe(firstTitleOf("Quedex"));
    await expect(page.getByTestId("alphabet-badge")).toHaveAttribute("data-visible", "false");

    const row = scroller(page).locator("[data-row-id]", { hasText: firstTitleOf("Quedex") });
    await row.getByRole("button", { name: `Play ${firstTitleOf("Quedex")}` }).click();
    await expect.poll(() => playingTitle(page)).toBe(firstTitleOf("Quedex"));
  });

  test("keypad digits multi-tap to a letter and OK plays its first item @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await openPlaylistSheet(page);
    await scroller(page).locator('[data-row-title="true"]').first().focus();

    // 7 is P Q R S: twice is Q.
    await page.keyboard.press("7");
    await page.keyboard.press("7");
    await expect.poll(() => topRowTitle(page), { timeout: 10_000 }).toBe(firstTitleOf("Quedex"));
    await expect.poll(() => focusedTitle(page)).toBe(firstTitleOf("Quedex"));

    await page.keyboard.press("Enter");
    await expect.poll(() => playingTitle(page)).toBe(firstTitleOf("Quedex"));
  });

  test("a letter beyond the loaded pages loads them and lands on it @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await openPlaylistSheet(page);
    await scroller(page).locator('[data-row-title="true"]').first().focus();

    await page.keyboard.press("y");
    await expect.poll(() => topRowTitle(page), { timeout: 15_000 }).toBe(firstTitleOf("Yie"));
    await expect.poll(() => focusedTitle(page)).toBe(firstTitleOf("Yie"));
  });

  test("using the rail on loaded letters raises no long task @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await openPlaylistSheet(page);
    await scroller(page).locator('[data-row-title="true"]').first().focus();
    // Load every page first: the cost measured here is the rail's, not the list's paging.
    await page.keyboard.press("z");
    await expect.poll(() => focusedTitle(page), { timeout: 15_000 }).toBe(firstTitleOf("Zoids"));
    await page.waitForTimeout(1_000);
    const longTasksSince = async (count: number) => (await longTaskCount(page)).slice(count).filter((ms) => ms > 50);

    let seen = (await longTaskCount(page)).length;
    for (const key of ["2", "5", "8", "3"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
    }
    await expect.poll(() => focusedTitle(page)).toBe(firstTitleOf("Delta"));
    await expect(page.getByTestId("alphabet-badge")).toHaveAttribute("data-visible", "false");
    expect(await longTasksSince(seen), "long tasks while jumping by key").toEqual([]);

    // A touch ends keypad mode, which re-lays the page out once; that is not the rail's cost.
    await page.getByRole("dialog").getByRole("heading", { name: "Playlist" }).click();
    await page.waitForTimeout(500);
    seen = (await longTaskCount(page)).length;
    await dragRailTo(page, "M", RAIL_LETTERS);
    await expect.poll(() => focusedTitle(page)).toBe(firstTitleOf("Monty"));
    await expect(page.getByTestId("alphabet-badge")).toHaveAttribute("data-visible", "false");
    expect(await longTasksSince(seen), "long tasks while dragging the rail").toEqual([]);
  });

  test("entering and returning to a page shows its marker without scrolling @layout", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-launch-phase", "app-ready");
    const shown = page.locator('body > [data-testid="scroll-position-indicator"][data-visible="true"]');
    await expect(shown).toHaveCount(1);
    await expect(shown).toHaveCount(0, { timeout: 3000 });
    await page.getByTestId("tab-home").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("swipe-navigation-runway")).toHaveAttribute("data-runway-phase", "idle");
    await expect(shown).toHaveCount(1);
    await expect(shown).toHaveCount(0, { timeout: 3000 });
    await page.keyboard.press("5");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("swipe-navigation-runway")).toHaveAttribute("data-runway-phase", "idle");
    await expect(shown).toHaveCount(1);
    const thumb = await shown.locator(".scroll-position-thumb").boundingBox();
    expect(thumb?.x).toBeGreaterThan(300);
    expect(thumb!.x + thumb!.width).toBeLessThanOrEqual(320);
  });

  test("the page scroll indicator shows while scrolling, covers nothing and fades @layout", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    const pageScroller = page.locator('[data-slot-active="true"] [data-page-scroll-container="true"]');
    await expect(pageScroller).toBeVisible();
    const thumbs = page.locator('body > [data-testid="scroll-position-indicator"]');
    await expect(thumbs.first()).toBeAttached();

    await pageScroller.evaluate((node) => node.scrollBy(0, 400));
    const shown = page.locator('body > [data-testid="scroll-position-indicator"][data-visible="true"]');
    await expect(shown).toHaveCount(1);
    await expect.poll(() => shown.evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(1);

    const geometry = await shown.evaluate((node) => {
      const thumb = node.firstElementChild!;
      const rect = thumb.getBoundingClientRect();
      const page = document.querySelector('[data-slot-active="true"] [data-page-scroll-container="true"]');
      const pageRect = page!.getBoundingClientRect();
      const tappable = [
        ...document.querySelectorAll('button, a[href], input, select, textarea, [role="switch"], [role="slider"]'),
      ]
        .filter((element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      return {
        thumb: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pointerEvents: getComputedStyle(thumb).pointerEvents,
        page: { top: pageRect.top, bottom: pageRect.bottom, right: pageRect.right },
        tappable: tappable.map((box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom })),
      };
    });
    expect(geometry.pointerEvents).toBe("none");
    expect(geometry.thumb.width).toBeLessThanOrEqual(4);
    expect(geometry.thumb.height).toBeGreaterThanOrEqual(23.5);
    expect(geometry.thumb.x + geometry.thumb.width).toBeLessThanOrEqual(geometry.page.right);
    expect(geometry.thumb.y).toBeGreaterThanOrEqual(geometry.page.top);
    expect(geometry.thumb.y + geometry.thumb.height).toBeLessThanOrEqual(geometry.page.bottom);
    for (const box of geometry.tappable) {
      expect(overlapArea(geometry.thumb, box as DOMRect), "the indicator lies over a control").toBe(0);
    }

    await expect(page.locator('body > [data-testid="scroll-position-indicator"][data-visible="true"]')).toHaveCount(0, {
      timeout: 3_000,
    });
    // An idle scroll-driven animation never finishes, so it must not outlive the fade: tests and
    // screenshot captures wait for the page's animations to settle.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((animation) =>
                ((animation.effect as KeyframeEffect | null)?.target as Element | null)?.classList.contains(
                  "scroll-position-thumb",
                ),
              ).length,
        ),
      )
      .toBe(0);
  });

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`the thumb follows the scroll position with reduced motion ${reducedMotion} @layout`, async ({ page }) => {
      // Isolate the system preference from the low-end-device policy on small CI runners.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
        Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      });
      await page.emulateMedia({ reducedMotion });
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
      expect(await page.evaluate(() => document.documentElement.classList.contains("c64-motion-reduced"))).toBe(
        reducedMotion === "reduce",
      );
      const pageScroller = page.locator('[data-slot-active="true"] [data-page-scroll-container="true"]');
      await expect(pageScroller).toBeVisible();

      for (const share of [0.25, 0.5, 1]) {
        await pageScroller.evaluate((node, fraction) => {
          node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
        }, share);
        const shown = page.locator('body > [data-testid="scroll-position-indicator"][data-visible="true"]');
        await expect(shown).toHaveCount(1);
        await expect
          .poll(() =>
            shown.evaluate((node) => {
              const page = document.querySelector<HTMLElement>(
                '[data-slot-active="true"] [data-page-scroll-container="true"]',
              )!;
              const thumb = node.firstElementChild!.getBoundingClientRect();
              const track = page.clientHeight - 8;
              const progress = page.scrollTop / (page.scrollHeight - page.clientHeight);
              const expectedTop = page.getBoundingClientRect().top + 4 + (track - thumb.height) * progress;
              return Math.round(Math.abs(thumb.top - expectedTop));
            }),
          )
          .toBeLessThanOrEqual(2);
      }
    });
  }

  test("a playlist item's sheet shows the indicator while its body scrolls @layout", async ({ page }) => {
    await seedLongPlaylist(page);
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    const row = page.locator('[data-slot-active="true"]').getByTestId("playlist-item").first();
    await row.getByRole("button", { name: "Item actions" }).click();
    const sheet = page.getByTestId("action-list-item-sheet");
    await expect(sheet).toBeVisible();
    const body = sheet.locator('[data-surface-body="true"]');
    expect(await body.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(true);
    await body.evaluate((node) => node.scrollBy(0, 80));
    await expect(indicator(page, sheet)).toHaveAttribute("data-visible", "true");
    await expect(indicator(page, sheet)).toHaveAttribute("data-visible", "false", { timeout: 3_000 });
  });

  test("a scrolling sheet shows its own indicator and a sheet that fits shows none @layout", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    const badge = page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await badge.evaluate((node) => (node as HTMLButtonElement).click());
    const diagnostics = page.getByTestId("diagnostics-sheet");
    await expect(diagnostics).toBeVisible();

    await diagnostics.getByTestId("open-filters-editor").click();
    const filters = page.getByTestId("filters-editor-surface");
    await expect(filters).toBeVisible();
    const filtersBody = filters.locator('[data-surface-body="true"]');
    const overflows = await filtersBody.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
    expect(overflows, "the filters sheet is expected to scroll at this size").toBe(true);
    await filtersBody.evaluate((node) => node.scrollBy(0, 120));
    await expect(indicator(page, filters)).toHaveAttribute("data-visible", "true");
    await expect(indicator(page, filters)).toHaveAttribute("data-host", "surface");
    await page.keyboard.press("Escape");
    await expect(filters).toBeHidden();

    // Connection details can overflow the compact panel with wider system fonts. Give this
    // half of the test enough height to exercise an actual fitting sheet on every platform.
    await page.setViewportSize({ width: 320, height: 800 });
    await diagnostics.getByTestId("diagnostics-overflow-menu").click();
    await diagnostics.getByTestId("diagnostics-connection-details-action").click();
    const connection = page.getByTestId("connection-view-surface");
    await expect(connection).toBeVisible();
    const connectionBody = connection.locator('[data-surface-body="true"]');
    expect(await connectionBody.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(false);
    await connectionBody.evaluate((node) => node.dispatchEvent(new Event("scroll")));
    await page.waitForTimeout(200);
    await expect(indicator(page, connection)).toHaveAttribute("data-visible", "false");
  });
});
