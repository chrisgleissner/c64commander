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
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { KEY_SELECTED_ATTRIBUTE as SELECTED, enableKeypad, ringFocus } from "./focusRing";

/**
 * The Docs guide read with the keypad alone on the smallest supported screen. Only key presses
 * drive it: every chapter is opened with OK, read to its last paragraph with Down, and left with
 * Back. At each stop the chapter must be inside the area between the app bar and the guidance bar,
 * no text may fall under the 14 px floor, and nothing may run off the side of the 320 px screen.
 */

const MIN_TEXT_PX = 14;

const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  await page.waitForTimeout(500);
};

const activeSlot = (page: Page) => page.locator('[data-slot-active="true"]');

/** The band a selected stop must sit in: below the app bar, above the keypad guidance bar. */
const visibleBand = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector('[data-slot-active="true"] [data-app-chrome-family="primary"]');
    const bar = document.querySelector('[data-testid="keypad-guidance-bar"]');
    return {
      top: header ? header.getBoundingClientRect().bottom : 0,
      bottom: bar ? bar.getBoundingClientRect().top : window.innerHeight,
    };
  });

const boxOf = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }, selector);

const selectedBox = (page: Page) => boxOf(page, `[${SELECTED}="true"]`);

const expectInsideBand = async (page: Page, box: { top: number; bottom: number } | null, what: string) => {
  expect(box, `${what} is not rendered`).not.toBeNull();
  const band = await visibleBand(page);
  expect(box!.top, `${what} starts under the app bar`).toBeGreaterThanOrEqual(band.top - 0.5);
  expect(box!.bottom, `${what} ends under the guidance bar`).toBeLessThanOrEqual(band.bottom + 0.5);
};

const expectNoHorizontalOverflow = async (page: Page, what: string) => {
  const overflow = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-slot-active="true"] [data-page-scroll-container]');
    const wide = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot-active="true"] [data-section-scope="docs"] *'),
    )
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5)
      .map((element) => element.getAttribute("data-testid") ?? element.tagName.toLowerCase());
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      wide,
    };
  });
  expect(overflow.document, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(1);
  expect(overflow.scroller, `${what}: the page body scrolls sideways`).toBeLessThanOrEqual(1);
  expect(overflow.wide, `${what}: elements run past the right edge`).toEqual([]);
};

const textBelowFloor = (page: Page, cardSelector: string) =>
  page.evaluate(
    ({ selector, floor }) => {
      const card = document.querySelector(selector);
      if (!card) return { inspected: 0, small: ["card missing"] };
      let inspected = 0;
      const small: string[] = [];
      for (const element of Array.from(card.querySelectorAll<HTMLElement>("*"))) {
        const ownText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (!ownText) continue;
        inspected += 1;
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        if (size < floor) small.push(`${size}px "${ownText.slice(0, 30)}"`);
      }
      return { inspected, small };
    },
    { selector: cardSelector, floor: MIN_TEXT_PX },
  );

/** The chapters, in page order, as the contents list names them. */
const chapterIds = (page: Page) =>
  activeSlot(page)
    .locator('[data-testid^="docs-contents-link-"]')
    .evaluateAll((links) =>
      links.map((link) => (link.getAttribute("data-testid") ?? "").replace("docs-contents-link-", "")),
    );

test.describe("Docs guide on the smallest screen, by keypad", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Reading-only coverage; trace assertions disabled.");
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

  test("every chapter opens with OK, reads to its end with Down, and stays clear of both bars @layout", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("keypad-guidance-bar")).toHaveAttribute("data-visible", "true");

    const ids = await chapterIds(page);
    expect(ids.length, "the guide has fewer chapters than it should").toBeGreaterThanOrEqual(16);

    for (const id of ids) {
      const cardSelector = `[data-slot-active="true"] [data-section-scope="docs"][data-section-id="${id}"]`;
      const card = page.locator(cardSelector);
      expect(await ringFocus(page, card), `the ring could not reach the ${id} chapter`).toBe(true);

      await page.keyboard.press("Enter");
      await expect(card, `OK did not open the ${id} chapter`).toHaveAttribute("data-open", "true");
      await expect(page.locator(`#docs-section-${id} [data-key-nav-reading]`).first()).toBeVisible();
      await page.waitForTimeout(350);
      await expectInsideBand(page, await boxOf(page, `#docs-toggle-${id}`), `the ${id} chapter header`);
      await expectNoHorizontalOverflow(page, `the ${id} chapter`);

      const text = await textBelowFloor(page, cardSelector);
      expect(text.inspected, `the ${id} chapter rendered almost no text`).toBeGreaterThan(5);
      expect(text.small, `text under ${MIN_TEXT_PX}px in the ${id} chapter`).toEqual([]);

      const stops = page.locator(`#docs-section-${id} [data-key-nav-reading]`);
      const stopCount = await stops.count();
      expect(stopCount, `the ${id} chapter has no reading stops`).toBeGreaterThan(2);

      // OK again goes into the chapter; from its header, Down walks every paragraph and step.
      await page.keyboard.press("Enter");
      for (let index = 0; index < stopCount; index += 1) {
        await page.keyboard.press("ArrowDown");
        const stop = stops.nth(index);
        await expect(stop, `Down did not reach stop ${index + 1} of ${id}`).toHaveAttribute(SELECTED, "true");
        await page.waitForTimeout(60);
        const box = await selectedBox(page);
        const band = await visibleBand(page);
        expect(box!.bottom - box!.top, `stop ${index + 1} of ${id} is taller than the screen can show`).toBeLessThan(
          band.bottom - band.top,
        );
        await expectInsideBand(page, box, `stop ${index + 1} of ${id}`);
      }

      // Back leaves the chapter, and the walk continues to the next one from here.
      await page.keyboard.press("Escape");
      await expect(card).toHaveAttribute(SELECTED, "true");
    }
  });

  test("the contents list jumps to a chapter, opens it, and hands it the keypad ring @layout", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.keyboard.press("ArrowDown");

    const contents = activeSlot(page).getByTestId("docs-card-contents");
    await expect(contents).toHaveAttribute("data-open", "true");
    await expectNoHorizontalOverflow(page, "the contents list");
    const contentsText = await textBelowFloor(page, '[data-slot-active="true"] [data-testid="docs-card-contents"]');
    expect(contentsText.small, "contents text under the floor").toEqual([]);

    const ids = await chapterIds(page);
    const target = ids[ids.length - 1];
    const link = activeSlot(page).getByTestId(`docs-contents-link-${target}`);
    expect(await ringFocus(page, link, 120), "the ring could not reach the last contents link").toBe(true);
    await page.keyboard.press("Enter");

    const card = activeSlot(page).locator(`[data-section-scope="docs"][data-section-id="${target}"]`);
    await expect(card).toHaveAttribute("data-open", "true");
    const toggle = page.locator(`#docs-toggle-${target}`);
    await expect(toggle).toHaveAttribute(SELECTED, "true");
    await page.waitForTimeout(400);
    await expectInsideBand(page, await boxOf(page, `#docs-toggle-${target}`), `the ${target} chapter header`);

    // The ring continues inside the chapter it jumped to.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(`#docs-section-${target} [data-key-nav-reading]`).first()).toHaveAttribute(
      SELECTED,
      "true",
    );
  });
});
