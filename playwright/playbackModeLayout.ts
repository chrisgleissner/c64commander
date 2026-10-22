/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, type Page } from "@playwright/test";

/** The same grid columns must own both pairs, including when credits wrap. */
export async function assertPlaybackModeLayout(page: Page) {
  const selectors = ["volume-mute", "volume-slider", "volume-label", "playback-shuffle", "playback-repeat"];
  const boxes = await Promise.all(selectors.map((id) => page.getByTestId(id).boundingBox()));
  const viewportWidth = page.viewportSize()!.width;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    expect(box, selectors[i]).not.toBeNull();
    expect(box.x, selectors[i]).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selectors[i]).toBeLessThanOrEqual(viewportWidth);
    expect(Math.abs(box.y + box.height / 2 - (boxes[0]!.y + boxes[0]!.height / 2))).toBeLessThan(1);
    if (i) expect(box.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width);
  }
  expect(boxes[1]!.width, "usable slider width").toBeGreaterThanOrEqual(44);
  for (const [mode, rating] of [
    ["playback-shuffle", "now-playing-notforme"],
    ["playback-repeat", "now-playing-like"],
  ]) {
    const button = page.getByTestId(mode);
    const upper = (await button.boundingBox())!;
    expect(upper.width).toBeGreaterThanOrEqual(44);
    expect(upper.height).toBeGreaterThanOrEqual(44);
    const icon = await button.locator("svg").boundingBox();
    expect(icon!.width).toBeGreaterThanOrEqual(20);
    expect(icon!.width).toBeLessThanOrEqual(24);
    const lowerButton = page.getByTestId(rating);
    if (await lowerButton.count()) {
      const lower = (await lowerButton.boundingBox())!;
      expect(lower.x).toBeCloseTo(upper.x, 1);
      expect(lower.width).toBeCloseTo(upper.width, 1);
      expect(lower.height).toBeCloseTo(upper.height, 1);
      const styles = await Promise.all(
        [button, lowerButton].map((item) =>
          item.evaluate((el) => ({
            radius: getComputedStyle(el).borderRadius,
            size: getComputedStyle(el.querySelector("svg")!).width,
            stroke: getComputedStyle(el.querySelector("svg")!).strokeWidth,
          })),
        ),
      );
      expect(styles[0]).toEqual(styles[1]);
      const facts = (await page.getByTestId("playback-current-facts").boundingBox())!;
      expect(facts.x + facts.width).toBeLessThanOrEqual(lower.x);
    }
  }
  const credits = page.getByTestId("playback-current-credits");
  if (await credits.count()) {
    const title = (await page.getByTestId("playback-current-title").boundingBox())!;
    const details = (await credits.boundingBox())!;
    const transport = (await page.getByTestId("playback-transport-row").boundingBox())!;
    expect(details.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(details.y + details.height).toBeLessThanOrEqual(transport.y);
  }
  if (await page.getByTestId("now-playing-notforme").count()) {
    await expect(page.getByTestId("now-playing-notforme").locator("svg")).toHaveClass(/lucide-x/);
  }
  await expect(page.getByRole("button", { name: "Reshuffle", exact: true })).toHaveCount(0);
}
