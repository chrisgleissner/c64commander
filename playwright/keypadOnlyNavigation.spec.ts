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
import { KEY_SELECTED_ATTRIBUTE as SELECTED, enableKeypad, ringFocus } from "./focusRing";
import { TAB_ROUTES } from "../src/lib/navigation/tabRoutes";

/**
 * The app driven by keys alone, on the smallest screen it supports.
 *
 * Some hardware the app has to run on leads with a physical keypad and a directional
 * pad, with touch present but secondary or awkward to use. On that hardware a control
 * that can only be reached by tapping cannot be reached at all, and the existing
 * keypad tests do not establish this end to end: they prove the focus ring exists and
 * that specific controls respond, but not that a user who never touches the screen can
 * get from the app opening to every primary page.
 *
 * These tests therefore never call click() or tap(). The only input is key presses.
 *
 * They run at the `compact` viewport because the two constraints interact: the smaller
 * the screen, the more the ring has to scroll to bring the next control into view, and
 * a control the ring can select but never scroll on screen is not reachable in any way
 * that matters.
 *
 * Runs on the default appearance style only, and is style-agnostic by construction anyway: reach
 * and scroll depend on box geometry, not colour, and appearanceGeometryInvariance.spec.ts proves
 * switching style changes zero geometry, so this holds for all twelve generated palettes.
 */

/** True when the element is inside the visible viewport, not merely in the DOM. */
const isOnScreen = (target: Locator) =>
  target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  });

const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  await page.waitForTimeout(500);
};

/** The top edge of the keypad guidance bar, which covers whatever lies below it. */
const guidanceBarTop = (page: Page) =>
  page.getByTestId("keypad-guidance-bar").evaluate((element) => element.getBoundingClientRect().top);

/** Sheets and menus open with a slide or zoom, so a box measured mid-animation is not where it settles. */
const waitForAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );

test.describe("Keypad-only navigation on the smallest screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Navigation-only coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
    });
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("Lighting exposes both Case Light and Keyboard Light after opening by keypad @layout", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const lighting = page.getByTestId("home-lighting-group");
    expect(await ringFocus(page, lighting)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(lighting).toHaveAttribute("data-open", "true");
    await page.waitForTimeout(400);
    // Opening a card is enough to freeze an animation-time scan. Do not force a new scan or
    // use DOM focus: that would repair the stale order before the test can observe it.
    expect(await ringFocus(page, page.getByTestId("home-led-summary"))).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("home-led-mode")).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-led-summary")).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("home-keyboard-lighting-summary")).toHaveAttribute(SELECTED, "true");
    expect(await isOnScreen(page.getByTestId("home-keyboard-lighting-mode"))).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("home-keyboard-lighting-mode")).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("home-led-summary")).toHaveAttribute(SELECTED, "true");
  });

  test("every enabled control in both lighting groups is selected and visible using only keys @layout", async ({
    page,
  }) => {
    await page.goto("/");
    await settle(page);
    expect(await ringFocus(page, page.getByTestId("home-lighting-group"))).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("home-lighting-group")).toHaveAttribute("data-open", "true");
    for (const prefix of ["home-led", "home-keyboard-lighting"]) {
      const group = page.getByTestId(`${prefix}-summary`);
      expect(await ringFocus(page, group)).toBe(true);
      // Inventory the rendered controls independently of the app's discovery engine. A missing
      // registration must fail here instead of being absent from both the expected and actual sets.
      const inventory = await group.evaluateHandle((element) =>
        Array.from(
          element.querySelectorAll<HTMLElement>("button,input:not([type=hidden]),select,textarea,[role=slider]"),
        )
          .filter((control) => !control.matches(":disabled,[aria-disabled=true]"))
          .filter((control) => !control.closest("[data-key-nav-skip]"))
          .filter((control) => control.getBoundingClientRect().height > 0),
      );
      const count = await inventory.evaluate((controls) => controls.length);
      expect(count).toBeGreaterThan(0);
      await page.keyboard.press("Enter");
      const reached = new Set<number>();
      for (let step = 0; step <= count; step++) {
        const index = await inventory.evaluate((controls) =>
          controls.indexOf(document.querySelector('[data-key-selected="true"]') as HTMLElement),
        );
        expect(index, `${prefix}: the ring must select an inventoried control`).toBeGreaterThanOrEqual(0);
        if (reached.has(index)) break;
        reached.add(index);
        expect(await isOnScreen(page.locator(`[${SELECTED}="true"]`))).toBe(true);
        await page.keyboard.press("ArrowDown");
      }
      expect(reached.size, `${prefix}: every enabled rendered control must be reachable`).toBe(count);
      await inventory.dispose();
      await page.keyboard.press("Escape");
    }
  });

  test("every primary page is reachable using only the keypad @layout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);

    // The first key press is what arms the ring; before it there is no highlight at
    // all, which is the documented "Prime Directive" behaviour.
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    for (const route of TAB_ROUTES) {
      const tabId = `tab-${route.label.toLowerCase()}`;
      const tab = page.getByTestId(tabId);

      const reached = await ringFocus(page, tab);
      expect(reached, `The focus ring could not reach the ${route.label} tab using key presses alone`).toBe(true);

      expect(
        await isOnScreen(tab),
        `The ${route.label} tab carries the focus ring but is not on screen, so a keypad user cannot see where they are`,
      ).toBe(true);

      await page.keyboard.press("Enter");
      await expect
        .poll(() => page.evaluate(() => window.location.pathname), {
          message: `Enter on the ${route.label} tab did not navigate`,
          timeout: 15_000,
        })
        .toBe(route.path);
      await page.waitForTimeout(400);
    }
  });

  test("the focus ring keeps its target on screen while walking a page @layout", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await settle(page);

    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    // Walk a long page and check the ring never selects something it has not also
    // scrolled into view. On a 426px-tall viewport this is the difference between a
    // usable page and one where the selection disappears under the tab bar.
    const offScreen: string[] = [];
    for (let step = 0; step < 40; step += 1) {
      const info = await page.evaluate(() => {
        const selected = document.querySelector('[data-key-selected="true"]');
        if (!selected) return null;
        const rect = selected.getBoundingClientRect();
        const label = (selected.getAttribute("data-testid") ?? selected.textContent ?? "").trim().slice(0, 40);
        return {
          label,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewportHeight: window.innerHeight,
        };
      });

      if (info && info.height > 0) {
        // Fully above the fold or fully below it means the user cannot see the ring.
        if (info.bottom <= 0 || info.top >= info.viewportHeight) {
          offScreen.push(`${info.label} (top ${Math.round(info.top)}, bottom ${Math.round(info.bottom)})`);
        }
      }

      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(120);
    }

    expect(offScreen, `The focus ring selected controls that were off screen:\n  ${offScreen.join("\n  ")}`).toEqual(
      [],
    );
  });

  /*
   * A bottom sheet stood on the bottom of the viewport while the keypad guidance bar covered its
   * last 32 px. On a 427 px screen that hid the last line of the empty Liked Tunes text, which no
   * key could reveal because the sheet's only stop is Close, and half of the selected Recent row.
   */
  test("a bottom sheet keeps its text above the keypad guidance bar @layout", async ({ page }) => {
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");

    const opener = page.locator('[data-slot-active="true"]').getByTestId("sid-radio-liked-tunes-open");
    expect(await ringFocus(page, opener), "the ring could not reach Liked Tunes").toBe(true);
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("liked-tunes-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("keypad-guidance-bar")).toHaveAttribute("data-visible", "true");
    await waitForAnimations(page);

    const barTop = await guidanceBarTop(page);
    const sheetBottom = await sheet.evaluate((element) => element.getBoundingClientRect().bottom);
    const textBottom = await sheet
      .getByTestId("liked-tunes")
      .evaluate((element) => element.getBoundingClientRect().bottom);
    expect(sheetBottom, "the sheet runs under the guidance bar").toBeLessThanOrEqual(barTop + 0.5);
    expect(textBottom, "the empty Liked Tunes text is under the guidance bar").toBeLessThanOrEqual(barTop + 0.5);
  });

  /*
   * The guidance bar's height is reserved at the bottom of `.page-stack`. Docs laid its cards out
   * without one, so its last card could not scroll clear of the bar and stayed 18 px under it.
   */
  test("every page's selected stop scrolls clear of the guidance bar @layout", async ({ page }) => {
    test.setTimeout(240_000);
    const covered: string[] = [];
    for (const route of TAB_ROUTES) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.keyboard.press("ArrowDown");
      await expect(page.getByTestId("keypad-guidance-bar")).toHaveAttribute("data-visible", "true");
      const seen = new Set<string>();
      for (let step = 0; step < 45; step += 1) {
        await page.waitForTimeout(150);
        const stop = await page.evaluate(() => {
          const selected = document.querySelector('[data-key-selected="true"]');
          const scroller = selected?.closest('[data-page-scroll-container="true"]');
          const bar = document.querySelector('[data-testid="keypad-guidance-bar"]');
          if (!selected || !scroller || !bar) return null;
          const rect = selected.getBoundingClientRect();
          const barTop = bar.getBoundingClientRect().top;
          const marginTop = Number.parseFloat(getComputedStyle(selected).scrollMarginTop) || 0;
          const fits = rect.height + marginTop <= barTop - scroller.getBoundingClientRect().top;
          return {
            id: selected.getAttribute("data-testid") ?? selected.textContent?.trim().slice(0, 40) ?? "",
            bottom: rect.bottom,
            barTop,
            fits,
          };
        });
        if (stop && stop.fits && !seen.has(stop.id)) {
          seen.add(stop.id);
          if (stop.bottom > stop.barTop + 0.5) {
            covered.push(
              `${route.path} ${stop.id}: bottom ${Math.round(stop.bottom)} > bar ${Math.round(stop.barTop)}`,
            );
          }
        }
        await page.keyboard.press("ArrowDown");
      }
    }
    expect(covered, `Selected stops left under the guidance bar:\n  ${covered.join("\n  ")}`).toEqual([]);
  });

  test("the last Recent row selected by keypad is clear of the guidance bar @layout", async ({ page }) => {
    await page.addInitScript(() => {
      const entries = Array.from({ length: 12 }, (_, index) => ({
        virtualPath: `/Usb0/Disks/Recent-Disk-${index + 1}.d64`,
        title: `Recent-Disk-${index + 1}.d64`,
        author: null,
        folder: "/Usb0/Disks",
        category: "disk",
        source: "ultimate",
        playedAt: 1_760_000_000_000 - index * 60_000,
      }));
      localStorage.setItem("c64u_recently_played:v2", JSON.stringify(entries));
    });
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");

    const opener = page.locator('[data-slot-active="true"]').getByTestId("hvsc-search-open");
    expect(await ringFocus(page, opener), "the ring could not reach Find a tune").toBe(true);
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("hvsc-search-sheet");
    const rows = sheet.getByTestId("recently-played-other-row");
    await expect(rows).toHaveCount(12);
    await expect(page.getByTestId("keypad-guidance-bar")).toHaveAttribute("data-visible", "true");
    await waitForAnimations(page);

    const last = rows.last();
    for (let step = 0; step < 40; step += 1) {
      if (await last.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(60);
    }
    expect(
      await last.evaluate((element) => element === document.activeElement),
      "Down never reached the last row",
    ).toBe(true);
    await page.waitForTimeout(300);

    const barTop = await guidanceBarTop(page);
    const rowBottom = await last.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(rowBottom, "the selected row is partly under the guidance bar").toBeLessThanOrEqual(barTop + 0.5);
  });

  /*
   * A playlist row's menu lists eleven detail rows above its actions. They were disabled menu items,
   * which a menu's arrow keys skip, so a keypad opened the menu on its first action with the details
   * scrolled above it and no key that could bring them back.
   */
  test("a playlist row's item sheet lets the keypad read every detail and reach every action, and Back returns to ⋮ @layout", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const items = Array.from({ length: 3 }, (_, index) => ({
        source: "ultimate",
        path: `/Usb0/Demos/MUSICIANS/Long_Directory_Name_For_Detail_Rows/Keypad_Menu_Tune_${index + 1}.sid`,
        name: `Keypad_Menu_Tune_${index + 1}.sid`,
        durationMs: 214_000,
        songNr: 1,
        sourceId: null,
      }));
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify({ items, currentIndex: 0 }));
    });
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");

    const trigger = page.locator('[data-slot-active="true"]').getByRole("button", { name: "Item actions" }).first();
    await expect(trigger).toBeAttached({ timeout: 15_000 });
    expect(await ringFocus(page, trigger), "the ring could not reach the row's menu button").toBe(true);
    // Near the top of the screen, where the dropdown this sheet replaced had the least room.
    await trigger.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("action-list-item-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await waitForAnimations(page);
    const sheetBottom = await sheet.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(sheetBottom, "the sheet runs under the guidance bar").toBeLessThanOrEqual(
      (await guidanceBarTop(page)) + 0.5,
    );

    const clipped = await sheet
      .locator("dd[data-detail-label], button")
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map(
            (element) =>
              `${(element.textContent ?? "").trim().slice(0, 40)} (${element.scrollWidth} > ${element.clientWidth})`,
          ),
      );
    expect(clipped, "details or actions whose text runs past the sheet's edge").toEqual([]);

    // Walk the whole sheet both ways, as a reader looking for the details would, and note every detail
    // and action that was wholly inside the sheet's visible body at some step.
    const seen = new Set<string>();
    const record = async () => {
      const visible = await sheet.evaluate((root) => {
        const body = root.querySelector(".overflow-y-auto")!.getBoundingClientRect();
        const bottom = Math.min(body.bottom, window.innerHeight);
        return Array.from(root.querySelectorAll<HTMLElement>("dd[data-detail-label], button"))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.height > 0 && rect.top >= body.top - 0.5 && rect.bottom <= bottom + 0.5;
          })
          .map((element) => element.getAttribute("data-detail-label") ?? (element.textContent ?? "").trim());
      });
      visible.forEach((label) => seen.add(label));
    };
    for (const key of ["ArrowDown", "ArrowUp"]) {
      for (let step = 0; step < 12; step += 1) {
        await record();
        await page.keyboard.press(key);
        await page.waitForTimeout(60);
      }
    }
    const expected = [
      "Type",
      "Duration",
      "Path",
      "Status",
      "Size",
      "Date",
      "Attached",
      "Origin",
      "Candidates",
      "Overrides",
      "Play",
      "Review playback config",
      "Attach local .cfg",
      "Attach C64U .cfg",
    ];
    expect(
      expected.filter((label) => !seen.has(label)),
      "details or actions the keypad never brought wholly on screen",
    ).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute(SELECTED, "true");
  });

  test("a selected card's top edge is never left under the app bar @layout", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await settle(page);

    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    // Only the step that selects a card is checked. Down on the page's last card scrolls on to the
    // text below it while the selection stays put, which moves that card up on purpose.
    const underAppBar: string[] = [];
    let previousLabel: string | null = null;
    for (let step = 0; step < 14; step += 1) {
      const info = await page.evaluate(() => {
        const selected = document.querySelector('[data-key-selected="true"]');
        const shell = selected?.closest(".page-shell");
        const appBar =
          shell?.closest("[data-route-index]")?.querySelector("header") ?? document.querySelector("header");
        if (!selected || !shell || !appBar) return null;
        return {
          label: selected.getAttribute("data-testid") ?? selected.tagName,
          top: selected.getBoundingClientRect().top,
          appBarBottom: appBar.getBoundingClientRect().bottom,
        };
      });
      const newlySelected = info !== null && info.label !== previousLabel;
      previousLabel = info?.label ?? null;
      if (info && newlySelected && info.top < info.appBarBottom) {
        underAppBar.push(`${info.label} (top ${Math.round(info.top)}, app bar ends ${Math.round(info.appBarBottom)})`);
      }
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
    }

    expect(underAppBar, `Selected cards whose top edge was under the app bar:\n  ${underAppBar.join("\n  ")}`).toEqual(
      [],
    );
  });

  test("Remote Input's keypad menu opens on its first item, and every item is on screen and big enough @layout", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    const openRemoteInput = page
      .locator('[data-slot-active="true"]')
      .getByTestId("home-machine-inline-openRemoteInput");
    expect(await ringFocus(page, openRemoteInput), "The ring could not reach Remote Input on Home").toBe(true);
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("remote-input-sheet");
    await expect(sheet).toBeVisible();

    await page.keyboard.press("F2");
    const menu = page.getByTestId("remote-input-controls-menu");
    await expect(menu).toBeVisible();
    const items = menu.locator('[data-testid^="remote-input-menu-"]');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(4);
    await expect(items.first()).toBeFocused();
    // The menu zooms in from 95%, so a box measured before that settles reads as low as 41.8 px.
    await waitForAnimations(page);
    const bar = page.getByTestId("keypad-guidance-bar");
    await expect(bar).toHaveAttribute("data-visible", "true");
    // On the compact screen the OK cap stands alone in this menu; the word "Select" cut entry names off.
    await expect(bar.getByTestId("keypad-guidance-center")).toBeVisible();
    await expect(bar.getByTestId("keypad-guidance-center").locator(".keypad-guidance-action")).toHaveText("");

    const problems: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      await expect(item).toBeFocused();
      const measured = await item.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.textContent?.trim() ?? "",
          width: rect.width,
          height: rect.height,
          onScreen:
            rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
          fontPx: Number.parseFloat(window.getComputedStyle(element).fontSize),
        };
      });
      await expect(
        page.getByTestId("keypad-guidance-breadcrumb"),
        "The guidance bar names the selected entry",
      ).toHaveText(measured.label);
      if (
        !(await page
          .locator(".keypad-guidance-breadcrumb-text")
          .evaluate((text) => text.scrollWidth <= text.clientWidth + 1))
      ) {
        problems.push(`${measured.label}: cut off in the guidance bar`);
      }
      if (measured.width < 44 || measured.height < 44) {
        problems.push(`${measured.label}: ${Math.round(measured.width)}x${Math.round(measured.height)}`);
      }
      if (!measured.onScreen) problems.push(`${measured.label}: selected but not on screen`);
      if (measured.fontPx < 14) problems.push(`${measured.label}: ${measured.fontPx}px text`);
      if (index < count - 1) await page.keyboard.press("ArrowDown");
    }
    expect(problems, `Keypad menu items that fail the keypad and size rules:\n  ${problems.join("\n  ")}`).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(sheet).toBeFocused();
  });

  test("closing Remote Input returns the selection to the Home control that opened it @layout", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    const openRemoteInput = page
      .locator('[data-slot-active="true"]')
      .getByTestId("home-machine-inline-openRemoteInput");
    expect(await ringFocus(page, openRemoteInput), "The ring could not reach Remote Input on Home").toBe(true);
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("remote-input-sheet");
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(openRemoteInput).toHaveAttribute(SELECTED, "true");
  });

  test("closing Remote Input from its keypad menu returns the selection to the Home control that opened it @layout", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    const openRemoteInput = page
      .locator('[data-slot-active="true"]')
      .getByTestId("home-machine-inline-openRemoteInput");
    expect(await ringFocus(page, openRemoteInput), "The ring could not reach Remote Input on Home").toBe(true);
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("remote-input-sheet");
    await expect(sheet).toBeVisible();

    await page.keyboard.press("F2");
    const close = page.getByTestId("remote-input-controls-menu").getByTestId("remote-input-menu-close");
    await expect(close).toBeVisible();
    for (
      let step = 0;
      step < 10 && !(await close.evaluate((element) => element === document.activeElement));
      step += 1
    ) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(sheet).toBeHidden();
    await expect(openRemoteInput).toHaveAttribute(SELECTED, "true");
  });

  test("closing a dialog by Back returns the selection to its opener, not to the tab bar @layout", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    const openers = [
      { opener: page.getByTestId("unified-health-badge"), dialog: page.getByTestId("diagnostics-sheet") },
      {
        opener: page.locator('[data-slot-active="true"]').getByTestId("home-save-ram"),
        dialog: page.getByTestId("save-ram-dialog"),
      },
    ];
    for (const { opener, dialog } of openers) {
      expect(await ringFocus(page, opener), "The ring could not reach the opener").toBe(true);
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await waitForAnimations(page);
      // On the keypad handset the first scan after the dialog has gone still sees the page hidden and
      // only the tab bar; desktop Chromium unhides the page first. This hides the page for that scan.
      await page.evaluate(() => {
        const slot = document.querySelector<HTMLElement>('[data-slot-active="true"]');
        const observer = new MutationObserver(() => {
          if (document.querySelector('[role="dialog"]')) return;
          observer.disconnect();
          slot?.setAttribute("aria-hidden", "true");
          setTimeout(() => slot?.removeAttribute("aria-hidden"), 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.waitForTimeout(800);
      await expect(opener).toHaveAttribute(SELECTED, "true");
    }
  });

  test("a page jump by number key lands on the new page's first own stop, not on the app bar @layout", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    for (const digit of ["2", "6", "1"]) {
      await page.keyboard.press(digit);
      await page.waitForTimeout(600);
      const selected = await page.evaluate(() => {
        const element = document.querySelector('[data-key-selected="true"]');
        return {
          id: element?.getAttribute("data-testid") ?? "",
          inAppBar: element?.closest('[data-testid="app-bar-row"]') !== null,
          inTabBar: element?.closest('[data-focus-scope="tabbar"]') !== null,
        };
      });
      expect(selected.inAppBar || selected.inTabBar, `After ${digit} the selection is ${selected.id}`).toBe(false);
    }
  });

  test("the guidance bar names Home's controls by what they act on, and the badge without cutting it @layout", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);
    const crumb = page.getByTestId("keypad-guidance-breadcrumb");
    const home = page.locator('[data-slot-active="true"]');

    const badge = page.getByTestId("unified-health-badge");
    for (let step = 0; step < 10 && (await badge.getAttribute(SELECTED)) !== "true"; step += 1) {
      await page.keyboard.press("ArrowUp");
    }
    await expect(badge).toHaveAttribute(SELECTED, "true");
    await expect(crumb).toHaveText(/^C64U: /);
    expect(
      await page
        .locator(".keypad-guidance-breadcrumb-text")
        .evaluate((text) => text.scrollWidth <= text.clientWidth + 1),
      "The badge's name is drawn whole in the guidance bar",
    ).toBe(true);

    const expected: Array<[string, RegExp]> = [
      ["home-drives-reset", /^Drives: reset$/],
      ["home-drive-toggle-a", /^Drive A power: (on|off)$/],
      ["home-drive-status-a", /^Drive A status: /],
    ];
    for (const [testId, name] of expected) {
      expect(await ringFocus(page, home.getByTestId(testId), 160), `The ring could not reach ${testId}`).toBe(true);
      await expect(crumb, testId).toHaveText(name);
    }
  });

  test("a tab jump back to a page left scrolled down keeps its position and selects a stop seen there @layout", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);
    const scrollTop = () =>
      page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-slot-active="true"] [data-page-scroll-container="true"]')
            ?.scrollTop ?? 0,
      );
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-slot-active="true"] [data-page-scroll-container="true"]',
      );
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(300);
    const leftAt = await scrollTop();
    expect(leftAt, "Play must be long enough to leave scrolled").toBeGreaterThan(200);

    const selectedPlacement = () =>
      page.evaluate(() => {
        const selected = document.querySelector<HTMLElement>('[data-key-selected="true"]');
        const bar = document.querySelector<HTMLElement>('[data-testid="keypad-guidance-bar"]');
        const header = document.querySelector<HTMLElement>('[data-slot-active="true"] header');
        if (!selected || !bar) return null;
        const rect = selected.getBoundingClientRect();
        return {
          id: selected.getAttribute("data-testid") ?? selected.textContent?.trim().slice(0, 30) ?? "",
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          headerBottom: Math.round(header?.getBoundingClientRect().bottom ?? 0),
          barTop: Math.round(bar.getBoundingClientRect().top),
        };
      });
    for (const digit of ["1", "2"]) {
      await page.keyboard.press(digit);
      await page.waitForTimeout(800);
      const placement = await selectedPlacement();
      expect(placement, `After ${digit} nothing is selected`).not.toBeNull();
      const { id, top, bottom, headerBottom, barTop } = placement!;
      const tall = bottom - top > barTop - headerBottom;
      expect(
        top >= headerBottom - 1 && (bottom <= barTop + 1 || (tall && top < barTop)),
        `After ${digit} ${id} is at ${top}..${bottom}, not whole inside ${headerBottom}..${barTop}`,
      ).toBe(true);
    }
    expect(Math.abs((await scrollTop()) - leftAt), "Play reopened where it was left").toBeLessThan(80);
  });

  test("closing Remote Input from its menu after closing Backup returns to the Input tile, not to Backup @layout", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);
    const home = page.locator('[data-slot-active="true"]');

    const backup = home.getByTestId("home-save-ram");
    expect(await ringFocus(page, backup), "The ring could not reach Backup").toBe(true);
    await page.keyboard.press("Enter");
    const backupDialog = page.getByTestId("save-ram-dialog");
    await expect(backupDialog).toBeVisible();
    await waitForAnimations(page);
    await page.keyboard.press("Escape");
    await expect(backupDialog).toBeHidden();
    await page.waitForTimeout(500);
    await expect(backup).toHaveAttribute(SELECTED, "true");

    const openRemoteInput = home.getByTestId("home-machine-inline-openRemoteInput");
    expect(await ringFocus(page, openRemoteInput), "The ring could not reach Remote Input").toBe(true);
    await page.keyboard.press("Enter");
    const sheet = page.getByTestId("remote-input-sheet");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("F2");
    const close = page.getByTestId("remote-input-controls-menu").getByTestId("remote-input-menu-close");
    await expect(close).toBeVisible();
    for (let step = 0; step < 10 && !(await close.evaluate((e) => e === document.activeElement)); step += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(500);

    await expect(openRemoteInput).toHaveAttribute(SELECTED, "true");
    await expect(backup).not.toHaveAttribute(SELECTED, "true");
  });

  test("the guidance bar names a Quick menu entry by its label, not the key cap beside it @layout", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.locator(`[${SELECTED}="true"]`).count()).toBeGreaterThan(0);

    await page.keyboard.press("ContextMenu");
    const docs = page.getByTestId("keypad-quick-menu-tab-docs");
    await expect(docs).toBeVisible();
    await expect(docs.locator("kbd")).toHaveText("6");
    for (
      let step = 0;
      step < 20 && !(await docs.evaluate((element) => element === document.activeElement));
      step += 1
    ) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(docs).toBeFocused();
    await expect(page.getByTestId("keypad-guidance-breadcrumb")).toHaveText("Docs");
  });

  test("a breadcrumb squeezed to a few characters shows nothing rather than a fragment @layout", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    const crumb = page.getByTestId("keypad-guidance-breadcrumb").locator(".keypad-guidance-breadcrumb-text");
    await expect(crumb).toBeVisible();

    // Widen the key legend until the breadcrumb beside it has 2rem left, as Remote Input's Keys mode does.
    await page.addStyleTag({
      content: ".keypad-guidance-keys { min-width: calc(100vw - 1.5rem - 0.75rem - 2rem); }",
    });
    expect(
      await page.getByTestId("keypad-guidance-breadcrumb").evaluate((element) => element.clientWidth),
    ).toBeLessThanOrEqual(32);
    await expect(crumb).toBeHidden();
  });
});
