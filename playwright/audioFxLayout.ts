/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, type Locator, type Page } from "@playwright/test";

const MIN_TEXT_PX = 14;
const MIN_BODY_TEXT_PX = 16;
const MIN_TARGET_PX = 44;

export const settle = async (page: Page, profile: string) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction((expected) => document.documentElement.dataset.displayProfile === expected, profile);
  await page.locator("nav.tab-bar").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-slot-active="true"] [data-page-scroll-container]').waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
};

export const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "The page scrolls horizontally").toBeLessThanOrEqual(1);
};

/** Text and controls inside `root` that are smaller than the floors the app holds every screen to. */
export const measureErgonomics = (root: Locator) =>
  root.evaluate(
    (element, floors) => {
      const textOffenders: string[] = [];
      const bodyOffenders: string[] = [];
      const targetOffenders: string[] = [];
      let textCount = 0;
      let targetCount = 0;
      for (const node of Array.from(element.querySelectorAll<HTMLElement>("*"))) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const own = Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent ?? "")
          .join("")
          .trim();
        const rect = node.getBoundingClientRect();
        if (own && rect.width > 0 && rect.height > 0) {
          textCount += 1;
          const px = Number.parseFloat(style.fontSize);
          if (px < floors.text) textOffenders.push(`${px}px "${own.slice(0, 30)}"`);
          if (
            node.tagName === "P" &&
            own.length >= 12 &&
            node.dataset.testid !== "spectrum-message" &&
            px < floors.body
          )
            bodyOffenders.push(`${px}px "${own.slice(0, 30)}"`);
          if (node.dataset.testid === "spectrum-message" && px < floors.body) bodyOffenders.push(`${px}px message`);
        }
        const isControl =
          node.matches('button, input, [role="switch"], [role="button"]') && !(node as HTMLButtonElement).disabled;
        if (isControl && rect.width > 0 && rect.height > 0) {
          targetCount += 1;
          const label = node.closest("label") ?? (node.id ? document.querySelector(`label[for="${node.id}"]`) : null);
          const labelRect = label?.getBoundingClientRect();
          const width = Math.max(rect.width, labelRect?.width ?? 0);
          const height = Math.max(rect.height, labelRect?.height ?? 0);
          const before = getComputedStyle(node, "::before");
          const hit = before.content !== "none" && before.position === "absolute";
          const w = hit ? Math.max(width, Number.parseFloat(before.width) || 0) : width;
          const h = hit ? Math.max(height, Number.parseFloat(before.height) || 0) : height;
          if (w < floors.target || h < floors.target)
            targetOffenders.push(`${Math.round(w)}x${Math.round(h)} ${node.dataset.testid ?? node.tagName}`);
        }
      }
      return { textOffenders, bodyOffenders, targetOffenders, textCount, targetCount };
    },
    { text: MIN_TEXT_PX, body: MIN_BODY_TEXT_PX, target: MIN_TARGET_PX },
  );

/** Each handle's centre lies on the drawn path, within half a pixel, measured on the live SVG. */
export const expectHandlesOnTheCurve = async (page: Page) => {
  const worst = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>('[data-testid="sound-tone-curve"]');
    const area = document.querySelector<HTMLElement>('[data-testid="sound-tone-area"]');
    if (!path || !area) throw new Error("The tone plot is not on the page");
    const length = path.getTotalLength();
    const height = area.getBoundingClientRect().height;
    let worstPx = 0;
    for (let band = 0; band < 10; band += 1) {
      const handle = document.querySelector<HTMLElement>(`[data-testid="sound-tone-point-${band}"]`);
      if (!handle) throw new Error(`Handle ${band} is missing`);
      const x = Number(handle.dataset.x);
      const y = Number(handle.dataset.y);
      let low = 0;
      let high = length;
      for (let i = 0; i < 40; i += 1) {
        const mid = (low + high) / 2;
        if (path.getPointAtLength(mid).x < x) low = mid;
        else high = mid;
      }
      worstPx = Math.max(worstPx, (Math.abs(path.getPointAtLength(high).y - y) * height) / 100);
    }
    return worstPx;
  });
  expect(worst, "Handles sit on the drawn curve").toBeLessThan(0.5);
};
