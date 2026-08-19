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
import { TAB_ROUTES } from "../src/lib/navigation/tabRoutes";

/**
 * Readability and reach on the smallest screen the app supports.
 *
 * The `compact` viewport is 320x426 CSS pixels. Because CSS pixels are
 * density-independent, text there is the same *physical* size as it is on a large
 * phone - a 3.25in panel does not shrink glyphs. What it does is take away room:
 * this viewport has under half the vertical space of the others, which is exactly
 * the pressure that leads to type being stepped down a size to make something fit.
 * These tests exist so that stops being an option, because the reader this has to
 * work for is a sighted adult of around sixty at a normal holding distance, for whom
 * reduced near focus and lower contrast sensitivity are ordinary rather than
 * exceptional. The answer to "it does not fit" has to be reflow or scroll, never
 * smaller type.
 *
 * The floors below are deliberately modest and are about legibility, not comfort:
 * they are a lower bound that should never be crossed, not a target to design to.
 *
 * This spec measures the type size, which is the cause. It cannot see the consequence
 * of enlarging the type, which is that the same words in the same box stop fitting it.
 * `smallScreenLayoutIntegrity.spec.ts` measures that, and the two are meant to be read
 * and changed together: this one stops type being shrunk to make something fit, and
 * that one stops type being enlarged without being given room.
 */

/**
 * No rendered text may be smaller than this, in CSS pixels.
 *
 * These floors are set for comfortable reading, not for the threshold of legibility.
 * The difference matters, and the arithmetic is worth writing down.
 *
 * A CSS pixel on Android is a density-independent pixel, about 1/160 inch, so 14px is
 * roughly 2.2mm from ascender to descender and an x-height near 1.1mm whatever the
 * panel's ppi. At a normal phone viewing distance of about 350mm, one arcminute of
 * visual angle is about 0.1mm, so that x-height subtends around 11 arcminutes.
 * Threshold acuity for 20/20 vision is about 5 arcminutes; comfortable sustained
 * reading wants roughly 16 to 18. A reader around sixty has essentially universal
 * presbyopia and measurably reduced contrast sensitivity, which pushes the comfortable
 * figure up rather than down.
 *
 * 14px is therefore a hard floor for incidental text, not a target, and 16px is the
 * floor for anything actually read. Nothing in this app should be set below the
 * `text-xs` step, and the smallest text on screen must still be readable at a glance:
 * the product is meant to be enjoyable to use, not an eye test.
 */
const MIN_TEXT_PX = 14;

/**
 * Body text - the text a user actually reads rather than glances at - may not be
 * smaller than this. 16px is the browser default body size and the usual
 * recommendation for older readers.
 */
const MIN_BODY_TEXT_PX = 16;

/**
 * Minimum size for anything the user has to hit or focus, in CSS pixels.
 *
 * 44 is the WCAG 2.5.5 target size. It matters here even though the target hardware
 * leads with a keypad: a focus ring that lands on a 20px control is as hard to see
 * as a 20px tap target is to hit.
 */
const MIN_TARGET_PX = 44;

type TextViolation = { text: string; fontPx: number; selector: string };
type TargetViolation = { label: string; width: number; height: number; selector: string };

const collectTextViolations = (page: Page, floor: number) =>
  page.evaluate((minPx) => {
    const describe = (element: Element) => {
      const parts = [element.tagName.toLowerCase()];
      const testId = element.getAttribute("data-testid");
      if (testId) parts.push(`[data-testid=${testId}]`);
      else if (element.id) parts.push(`#${element.id}`);
      else if (typeof element.className === "string" && element.className.trim()) {
        const cls = element.className.trim().split(/\s+/).slice(0, 3).join(".");
        if (cls) parts.push(`.${cls}`);
      }
      return parts.join("");
    };

    const results: Array<{ text: string; fontPx: number; selector: string }> = [];
    const seen = new Set<Element>();

    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (seen.has(element)) continue;
      // Only elements that render text directly, so a wrapper is not blamed for its
      // children's type size.
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (!ownText) continue;

      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // Effectively invisible, so its size is not a legibility question. This is not a
      // hypothetical: the test heartbeat probe is an 8px counter parked in a corner at
      // 0.01 opacity, and a plain `opacity === 0` check would let it through.
      if (Number.parseFloat(style.opacity) < 0.1) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      // Off-screen (the swipe runway keeps adjacent pages mounted).
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth) continue;

      const fontPx = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(fontPx) || fontPx >= minPx) continue;

      seen.add(element);
      results.push({ text: ownText.slice(0, 40), fontPx, selector: describe(element) });
    }
    return results;
  }, floor);

const collectTargetViolations = (page: Page, floor: number) =>
  page.evaluate((minPx) => {
    const describe = (element: Element) => {
      const parts = [element.tagName.toLowerCase()];
      const testId = element.getAttribute("data-testid");
      if (testId) parts.push(`[data-testid=${testId}]`);
      else if (element.id) parts.push(`#${element.id}`);
      else if (typeof element.className === "string" && element.className.trim()) {
        parts.push(`.${element.className.trim().split(/\s+/).slice(0, 4).join(".")}`);
      }
      const role = element.getAttribute("role");
      if (role) parts.push(`[role=${role}]`);
      return parts.join("");
    };

    const selector = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"]';
    const results: Array<{ label: string; width: number; height: number; selector: string }> = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number.parseFloat(style.opacity) < 0.1) continue;
      if ((element as HTMLButtonElement).disabled) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth) continue;
      // Hidden inputs and the like.
      if (element.tagName === "INPUT" && (element as HTMLInputElement).type === "hidden") continue;

      // Measure the effective target, not just the control. A small checkbox inside a
      // label is pressed by pressing anywhere on the label - that is the browser's own
      // behaviour, and it is the area the user actually aims at - so the label's box is
      // what decides whether the target is big enough.
      let effective = rect;
      // A label that wraps the control, or one bound to it by `for`, is activated by
      // pressing it and so counts as part of the target either way.
      const wrapping = element.closest("label");
      const bound = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
      for (const candidate of [wrapping, bound]) {
        if (!candidate) continue;
        const candidateRect = candidate.getBoundingClientRect();
        if (candidateRect.width >= effective.width && candidateRect.height >= effective.height) {
          effective = candidateRect;
        }
      }

      if (effective.width >= minPx && effective.height >= minPx) continue;

      results.push({
        label: (element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 40),
        width: Math.round(effective.width),
        height: Math.round(effective.height),
        selector: describe(element),
      });
    }
    return results;
  }, floor);

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc, "Document overflows horizontally").toBeLessThanOrEqual(1);
  expect(overflow.body, "Body overflows horizontally").toBeLessThanOrEqual(1);

  // The document measure alone is not enough. A `position: fixed` element sized to the
  // viewport does not extend the document's scrollWidth, so its contents can run off
  // the right edge and be clipped with both numbers above still reading zero. That is
  // exactly how the tab bar came to have "Docs" cut in half with every check passing.
  // This looks for any visible element whose own content is wider than the box drawn
  // for it, which catches the clipped case as well as the overflowing one.
  const clipped = await page.evaluate(() => {
    const offenders: Array<{ selector: string; scrollWidth: number; clientWidth: number }> = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("nav, header, footer, main"))) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // Skip elements that scroll horizontally by design (HARD25-002's tab bar): their
      // scrollWidth > clientWidth is intended, not clipped. A fixed-px tolerance was
      // tried instead and proved environment-fragile (2px locally, 7px on CI's font
      // metrics for the same markup). Non-scrollable elements still use 1px.
      const scrollable = style.overflowX === "auto" || style.overflowX === "scroll";
      if (!scrollable && element.scrollWidth - element.clientWidth > 1) {
        const testId = element.getAttribute("data-testid");
        offenders.push({
          selector: `${element.tagName.toLowerCase()}${testId ? `[data-testid=${testId}]` : `.${element.className.split(/\s+/)[0]}`}`,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        });
      }
    }
    return offenders;
  });
  expect(
    clipped,
    `App chrome is wider than the space it has, so its contents are clipped:\n` +
      clipped.map((c) => `  ${c.selector}: content ${c.scrollWidth}px in ${c.clientWidth}px`).join("\n"),
  ).toEqual([]);
};

const settle = async (page: Page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
  // Wait for the tab bar, which only exists once the launch sequence has handed over
  // to a real page. Without this the measurement can land on the startup screen and
  // report that everything is fine because almost nothing is on screen yet.
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  // Let the page paint before anything is measured.
  await page.waitForTimeout(600);
};

test.describe("Small screen ergonomics", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem("c64u_display_profile_override", "compact");
    });
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const route of TAB_ROUTES) {
    test(`${route.label} is legible and reachable at the smallest supported size @layout`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settle(page);

      await expectNoHorizontalOverflow(page);

      const textViolations = (await collectTextViolations(page, MIN_TEXT_PX)) as TextViolation[];
      expect(
        textViolations,
        `Text below the ${MIN_TEXT_PX}px legibility floor on ${route.label}:\n` +
          textViolations.map((v) => `  ${v.fontPx}px  ${v.selector}  "${v.text}"`).join("\n"),
      ).toEqual([]);

      const targetViolations = (await collectTargetViolations(page, MIN_TARGET_PX)) as TargetViolation[];
      expect(
        targetViolations,
        `Controls below the ${MIN_TARGET_PX}px target size on ${route.label}:\n` +
          targetViolations.map((v) => `  ${v.width}x${v.height}  ${v.selector}  "${v.label}"`).join("\n"),
      ).toEqual([]);
    });
  }

  test("body text is not stepped down to fit the smallest screen @layout", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settle(page);

    const main = page.locator("main").first();
    const bodyTextSizes = await main.evaluate((root, minPx) => {
      const offenders: Array<{ text: string; fontPx: number }> = [];
      for (const element of Array.from(root.querySelectorAll<HTMLElement>("p, li, dd, dt"))) {
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join("")
          .trim();
        if (own.length < 12) continue;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const fontPx = Number.parseFloat(style.fontSize);
        if (fontPx < minPx) offenders.push({ text: own.slice(0, 40), fontPx });
      }
      return offenders;
    }, MIN_BODY_TEXT_PX);

    expect(
      bodyTextSizes,
      `Body text below the ${MIN_BODY_TEXT_PX}px floor:\n` +
        bodyTextSizes.map((v) => `  ${v.fontPx}px  "${v.text}"`).join("\n"),
    ).toEqual([]);
  });
});
