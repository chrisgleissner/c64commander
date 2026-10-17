/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Locator } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";

const { viewport, override } = DISPLAY_PROFILE_VIEWPORTS.medium;
const MIN_TITLE_COLUMN_PX = 110;
const NAMES = ["Darkness Zone", "Paperboy", "Commando Special Edition"];

/** Every alphanumeric word of the title that the browser laid out across more than one line. */
const splitWords = (title: Locator) =>
  title.evaluate((element) => {
    const split: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (const match of text.matchAll(/[A-Za-z0-9]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index ?? 0);
        range.setEnd(node, (match.index ?? 0) + match[0].length);
        const lineTops = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
        if (lineTops.size > 1) split.push(match[0]);
      }
    }
    return split;
  });

const expectTitlesWholeAndMenuAtRightEnd = async (rows: Locator) => {
  await expect(rows).toHaveCount(NAMES.length);
  for (let index = 0; index < NAMES.length; index += 1) {
    const row = rows.nth(index);
    const title = row.locator('[data-row-title="true"]');
    await expect(title).toBeVisible();
    const metrics = await title.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      columnWidth: element.parentElement?.clientWidth ?? 0,
    }));
    expect(metrics.scrollWidth, `row ${index} title overflows its box`).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.columnWidth, `row ${index} title column width`).toBeGreaterThanOrEqual(MIN_TITLE_COLUMN_PX);
    expect(await splitWords(title), `row ${index} words split across lines`).toEqual([]);

    const rowBox = (await row.boundingBox())!;
    const menuBox = (await row.getByRole("button", { name: "Item actions" }).boundingBox())!;
    const titleBox = (await title.boundingBox())!;
    expect(menuBox.x + menuBox.width, `row ${index} menu is at the right end`).toBeGreaterThanOrEqual(
      rowBox.x + rowBox.width - 12,
    );
    expect(menuBox.x, `row ${index} menu is after the title`).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 1);
  }
};

test.describe("Dense list rows on the medium display profile", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript((profile) => localStorage.setItem("c64u_display_profile_override", profile), override);
    await page.setViewportSize(viewport);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("playlist rows keep whole words and the item menu at the right end", async ({ page }) => {
    await page.addInitScript((names) => {
      const items = names.map((name) => ({
        source: "ultimate",
        path: `/Usb0/Demos/${name}.sid`,
        name: `${name}.sid`,
        durationMs: 5000,
      }));
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify({ items, currentIndex: -1 }));
    }, NAMES);
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await expectTitlesWholeAndMenuAtRightEnd(page.getByTestId("playlist-item"));
  });

  test("disk rows keep whole words and the item menu at the right end", async ({ page }) => {
    await page.addInitScript((names) => {
      const disks = names.map((name, index) => ({
        id: `local:/Disks/${name}.d64`,
        name: `${name}.d64`,
        path: `/Disks/${name}.d64`,
        location: "local",
        group: null,
        importOrder: index + 1,
        importedAt: new Date().toISOString(),
      }));
      localStorage.setItem("c64u_disk_library:TEST-123", JSON.stringify({ disks }));
    }, NAMES);
    await page.goto("/disks", { waitUntil: "domcontentloaded" });
    await expectTitlesWholeAndMenuAtRightEnd(page.getByTestId("disk-row"));
  });
});
