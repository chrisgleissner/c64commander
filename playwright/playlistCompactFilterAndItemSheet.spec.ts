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
import { KEY_SELECTED_ATTRIBUTE as SELECTED, enableKeypad, ringFocus } from "./focusRing";
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";

/**
 * The playlist's filter and a row's item actions on the smallest screen the app supports.
 *
 * On a 320x427 CSS px panel the filter field and five type checkboxes took 192 px of the page and
 * 239 px of the View all sheet, which left 97 px for the list in the sheet. A row's ⋮ menu opened
 * as a dropdown in the space between the row and the screen edge, which showed three of its
 * fourteen entries. These tests hold the replacement to its promises: the filter folds into one
 * row when the reader moves on to the list and says what it is filtering while folded, its type
 * checkboxes fit on one line, folding never moves the rows under the reader, and the item actions
 * open as a sheet whose every detail and action can be brought on screen by touch. The keypad walk
 * through that sheet is in keypadOnlyNavigation.spec.ts, with the other keys-only tests.
 */

test.use({ viewport: { width: 320, height: 427 }, deviceScaleFactor: 1.5 });

const ACTIVE = '[data-slot-active="true"]';
const active = (page: Page) => page.locator(ACTIVE);
const filterPanel = (page: Page) => active(page).getByTestId("list-filter-toggle-panel");
const filterToggle = (page: Page) => active(page).getByTestId("list-filter-toggle");
const firstRow = (page: Page) => active(page).getByTestId("playlist-item").first();

const seedPlaylist = (page: Page, count: number) =>
  page.addInitScript((count) => {
    const extensions = ["sid", "mod", "prg", "crt", "d64"];
    const items = Array.from({ length: count }, (_, index) => {
      const name = `Tune_${String(index + 1).padStart(4, "0")}.${extensions[index % extensions.length]}`;
      return {
        source: "ultimate",
        path: `/Usb0/Demos/MUSICIANS/Long_Directory_Name_For_Detail_Rows/${name}`,
        name,
        durationMs: 214_000,
        songNr: 1,
        sourceId: null,
      };
    });
    localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify({ items, currentIndex: 0 }));
  }, count);

const openPlay = async (page: Page) => {
  await page.goto("/play", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  await expect(firstRow(page)).toBeVisible({ timeout: 15_000 });
};

/** Brings the filter to the middle of the screen, the way a reader scrolled to the playlist sees it. */
const scrollFilterIntoView = async (page: Page) => {
  await expect
    .poll(async () => {
      await filterToggle(page).evaluate((element) => element.scrollIntoView({ block: "center" }));
      return filterToggle(page).evaluate((element) => Math.abs(element.getBoundingClientRect().top - 190) < 60);
    })
    .toBe(true);
};

/** Wheel input over the middle of the screen, which is page content on every layout these tests use. */
const wheelOverPage = async (page: Page, deltaY: number) => {
  await page.mouse.move(160, 213);
  await page.mouse.wheel(0, deltaY);
};

const topOf = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().top);

const waitForAnimations = (page: Page) =>
  page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ),
  );

test.describe("Playlist filter and item actions on the smallest screen", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Compact layout and keypad coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await seedPlaylist(page, 30);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("the filter starts folded into one row and unfolds by touch @layout", async ({ page }) => {
    await openPlay(page);
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "false");
    await expect(active(page).getByTestId("list-filter-input")).toHaveCount(0);
    const folded = await filterPanel(page).evaluate((element) => element.getBoundingClientRect().height);
    expect(folded, "the folded filter is one 44 px row").toBeLessThanOrEqual(48);

    await filterToggle(page).click();
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "true");
    await expect(active(page).getByTestId("list-filter-input")).toBeVisible();
    await expect(active(page).getByTestId("playlist-type-songs")).toBeVisible();
  });

  test("the type filters fit on one line at the default text size @layout", async ({ page }) => {
    await openPlay(page);
    await filterToggle(page).click();
    const labels = await active(page)
      .locator('[data-testid^="playlist-type-"]')
      .evaluateAll((boxes) =>
        boxes.map((box) => {
          const label = box.closest("label") as HTMLElement;
          const rect = label.getBoundingClientRect();
          return {
            id: box.getAttribute("data-testid"),
            top: Math.round(rect.top),
            right: rect.right,
            fontSize: parseFloat(getComputedStyle(label).fontSize),
            panelRight: (box.closest('[data-testid="list-filter-toggle-panel"]') as HTMLElement).getBoundingClientRect()
              .right,
          };
        }),
      );
    expect(labels.map((label) => label.id)).toEqual([
      "playlist-type-songs",
      "playlist-type-progs",
      "playlist-type-disks",
    ]);
    expect(new Set(labels.map((label) => label.top)).size, "the three type filters share one line").toBe(1);
    for (const label of labels) {
      expect(label.right, `${label.id} runs past the filter`).toBeLessThanOrEqual(label.panelRight + 0.5);
      expect(label.fontSize, `${label.id} is set below the 14 px floor`).toBeGreaterThanOrEqual(14);
    }
  });

  test("at the largest text size the type filters may wrap but are never cut or shrunk @layout", async ({ page }) => {
    await page.addInitScript((scale) => localStorage.setItem("c64u_text_scale", scale), LARGEST_TEXT_SCALE_ID);
    await openPlay(page);
    await filterToggle(page).click();
    const problems = await active(page)
      .locator('[data-testid^="playlist-type-"]')
      .evaluateAll((boxes) =>
        boxes.flatMap((box) => {
          const label = box.closest("label") as HTMLElement;
          const panel = box.closest('[data-testid="list-filter-toggle-panel"]') as HTMLElement;
          const rect = label.getBoundingClientRect();
          const issues: string[] = [];
          if (rect.right > panel.getBoundingClientRect().right + 0.5) issues.push(`${label.textContent} runs past`);
          if (label.scrollWidth > label.clientWidth + 1) issues.push(`${label.textContent} is clipped`);
          if (parseFloat(getComputedStyle(label).fontSize) < 16) issues.push(`${label.textContent} was shrunk`);
          return issues;
        }),
      );
    expect(problems).toEqual([]);
  });

  test("scrolling the playlist by touch folds the filter, keeps the rows still and shows the active filter @layout", async ({
    page,
  }) => {
    await openPlay(page);
    await scrollFilterIntoView(page);
    await filterToggle(page).click();
    await active(page).getByTestId("playlist-type-songs").click();
    await expect(active(page).getByTestId("playlist-type-songs")).not.toBeChecked();
    await expect(firstRow(page)).toContainText("Tune_0003");

    const before = await topOf(firstRow(page));
    await wheelOverPage(page, 60);
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "false");
    await page.waitForTimeout(150);
    const moved = before - (await topOf(firstRow(page)));
    expect(Math.abs(moved - 60), `the row moved ${moved} px for a 60 px scroll`).toBeLessThanOrEqual(2);
    await expect(filterToggle(page)).toHaveText("Filter: Progs, Disks");
    await expect(filterToggle(page)).toHaveAttribute("data-filter-active", "true");
  });

  test("the filter stays open while the reader is typing in it, even as the list scrolls @layout", async ({ page }) => {
    await openPlay(page);
    await scrollFilterIntoView(page);
    await filterToggle(page).click();
    const input = active(page).getByTestId("list-filter-input");
    await input.click();
    await input.pressSequentially("Tune_00");
    await wheelOverPage(page, 80);
    await page.waitForTimeout(200);
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "true");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Tune_00");
  });

  test("the keypad unfolds the filter with OK and folds it by moving into the list @layout", async ({ page }) => {
    await enableKeypad(page);
    await openPlay(page);
    await page.keyboard.press("ArrowDown");
    expect(await ringFocus(page, filterToggle(page)), "the ring could not reach the filter").toBe(true);
    await page.keyboard.press("Enter");
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "true");
    await expect(filterToggle(page)).toHaveAttribute(SELECTED, "true");

    const songs = active(page).getByTestId("playlist-type-songs");
    expect(await ringFocus(page, songs, 6), "the ring could not reach the type filters").toBe(true);
    await page.keyboard.press("Enter");
    await expect(songs).not.toBeChecked();
    await expect(filterPanel(page), "the filter folded while the keypad was using it").toHaveAttribute(
      "data-expanded",
      "true",
    );

    const selectAll = active(page).getByTestId("playlist-list-toggle-select-all");
    expect(await ringFocus(page, selectAll, 6), "the ring could not move into the list").toBe(true);
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "false");
    await expect(filterToggle(page)).toHaveText("Filter: Progs, Disks");

    for (let step = 0; step < 6 && (await filterToggle(page).getAttribute(SELECTED)) !== "true"; step += 1) {
      await page.keyboard.press("ArrowUp");
    }
    await expect(filterToggle(page)).toHaveAttribute(SELECTED, "true");
    await page.keyboard.press("Enter");
    await expect(filterPanel(page)).toHaveAttribute("data-expanded", "true");
  });

  test("the View all sheet folds its filter when its list is scrolled, without moving the rows @layout", async ({
    page,
  }) => {
    await openPlay(page);
    await active(page).getByRole("button", { name: "View all" }).click();
    const sheet = page.getByTestId("action-list-view-all");
    await expect(sheet).toBeVisible();
    await waitForAnimations(page);
    const toggle = sheet.getByTestId("view-all-filter-toggle");
    const panel = sheet.getByTestId("view-all-filter-toggle-panel");
    await expect(panel).toHaveAttribute("data-expanded", "false");
    await toggle.click();
    await expect(panel).toHaveAttribute("data-expanded", "true");

    const row = sheet.getByTestId("playlist-item").nth(2);
    const box = await sheet.locator('[data-virtuoso-scroller="true"]').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // Far enough to count as scrolling, not yet far enough to scroll back by what folding gives up.
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(150);
    await expect(panel, "folded before the list could be held still").toHaveAttribute("data-expanded", "true");

    const before = await topOf(row);
    await page.mouse.wheel(0, 120);
    await expect(panel).toHaveAttribute("data-expanded", "false");
    await page.waitForTimeout(150);
    const moved = before - (await topOf(row));
    expect(Math.abs(moved - 120), `the row moved ${moved} px for a 120 px scroll`).toBeLessThanOrEqual(2);
  });

  test("a row's ⋮ opens a sheet in which every detail and action can be read and reached by touch @layout", async ({
    page,
  }) => {
    await openPlay(page);
    await scrollFilterIntoView(page);
    await firstRow(page).getByRole("button", { name: "Item actions" }).click();
    const sheet = page.getByTestId("action-list-item-sheet");
    await expect(sheet).toBeVisible();
    await waitForAnimations(page);
    await expect(page.getByRole("dialog", { name: "Tune 0001" })).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);

    const details = [
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
    ];
    const actions = ["Play", "Review playback config", "Attach local .cfg", "Attach C64U .cfg"];
    const targets = [
      ...details.map((label) => sheet.locator(`dd[data-detail-label="${label}"]`).first()),
      ...actions.map((name) => sheet.getByRole("button", { name: name === "Play" ? /^Play / : name })),
    ];
    const unreadable: string[] = [];
    for (const target of targets) {
      await target.scrollIntoViewIfNeeded();
      const result = await target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const body = element.closest(".overflow-y-auto")!.getBoundingClientRect();
        const name = (element.getAttribute("data-detail-label") ?? element.textContent ?? "").trim();
        const fits =
          rect.top >= body.top - 0.5 && rect.bottom <= body.bottom + 0.5 && rect.bottom <= window.innerHeight;
        const clipped = element.scrollWidth > element.clientWidth + 1;
        return { name, ok: fits && !clipped && rect.height > 0, height: rect.height };
      });
      if (!result.ok) unreadable.push(result.name);
      if (result.name && actions.some((action) => result.name.startsWith(action))) {
        expect(result.height, `${result.name} is below the 44 px target size`).toBeGreaterThanOrEqual(44);
      }
    }
    expect(unreadable, "details or actions that cannot be brought fully on screen").toEqual([]);
    await expect(sheet.locator('dd[data-detail-label="Path"]')).toHaveText(
      "/Usb0/Demos/MUSICIANS/Long_Directory_Name_For_Detail_Rows/Tune_0001.sid",
    );
  });

  test("the sheet plays the item in one press @layout", async ({ page }) => {
    await openPlay(page);
    const row = active(page).getByTestId("playlist-item").nth(1);
    await row.getByRole("button", { name: "Item actions" }).click();
    const sheet = page.getByTestId("action-list-item-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("action-list-item-sheet-primary").click();
    await expect(sheet).toBeHidden();
    await expect(row).toHaveAttribute("data-playing", "true", { timeout: 15_000 });
  });
});
