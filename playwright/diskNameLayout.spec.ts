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
import { DISPLAY_PROFILE_VIEWPORTS, type DisplayProfileViewportId } from "./displayProfileViewports";

const DISK_NAME = "Turrican_(Original)_S1.d64";
const GROUP_NAME = "Turrican_(Original)";
const PROFILES: DisplayProfileViewportId[] = ["compact", "medium", "expanded"];
const SCREENSHOT_DIR = process.env.DISK_LAYOUT_SCREENSHOT_DIR;

const seedTurricanDisks = (page: Page) =>
  page.addInitScript(
    ({ group }) => {
      const disks = ["S1", "S2"].map((side, index) => ({
        id: `ultimate:/Usb0/Games/Turrican/Turrican_(Original)_${side}.d64`,
        name: `Turrican_(Original)_${side}.d64`,
        path: `/Usb0/Games/Turrican/Turrican_(Original)_${side}.d64`,
        location: "ultimate",
        group,
        importOrder: index + 1,
        importedAt: new Date().toISOString(),
      }));
      localStorage.setItem("c64u_disk_library:TEST-123", JSON.stringify({ disks }));
    },
    { group: GROUP_NAME },
  );

type TextLayout = { width: number; midWordBreaks: string[] };

/** The element's width and every line break that falls between two letters or digits. */
const measureText = (locator: Locator): Promise<TextLayout> =>
  locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const chars: Array<{ char: string; top: number }> = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (let index = 0; index < text.length; index += 1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects()[0];
        if (rect) chars.push({ char: text[index], top: Math.round(rect.top) });
      }
    }
    const midWordBreaks: string[] = [];
    for (let index = 1; index < chars.length; index += 1) {
      const [before, after] = [chars[index - 1], chars[index]];
      if (after.top > before.top + 2 && /[A-Za-z0-9]/.test(before.char) && /[A-Za-z0-9]/.test(after.char)) {
        midWordBreaks.push(`${before.char}|${after.char}`);
      }
    }
    return { width: element.getBoundingClientRect().width, midWordBreaks };
  });

const widthOf = async (locator: Locator) => (await locator.boundingBox())?.width ?? 0;

const capture = async (page: Page, name: string) => {
  if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
};

test.describe("Disk names get room to read", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }) => {
    server = await createMockC64Server({}, {}, { timingMode: "fast" });
    await seedUiMocks(page, server.baseUrl);
    await seedTurricanDisks(page);
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const profile of PROFILES) {
    test(`${profile}: disk names and group labels take at least half the row and break only between words`, async ({
      page,
    }) => {
      await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
      await page.goto("/disks", { waitUntil: "domcontentloaded" });
      await page.waitForFunction((expected) => document.documentElement.dataset.displayProfile === expected, profile);
      await expect(page.getByTestId("startup-launch-sequence")).toHaveCount(0, { timeout: 15_000 });
      const row = page.getByTestId("disk-list").getByTestId("disk-row").filter({ hasText: DISK_NAME }).first();
      await row.scrollIntoViewIfNeeded();
      await capture(page, `${profile}-disk-list`);

      const rowWidth = await widthOf(row);
      const title = row.getByRole("button", { name: DISK_NAME, exact: true });
      const titleLayout = await measureText(title);
      const titleColumnWidth = await widthOf(title.locator(".."));
      expect.soft(titleColumnWidth, "disk name column width vs row width").toBeGreaterThanOrEqual(rowWidth * 0.5);
      expect.soft(titleLayout.midWordBreaks, "disk name breaks inside a word").toEqual([]);
      const groupLayout = await measureText(row.getByText(`Group: ${GROUP_NAME}`, { exact: true }));
      expect.soft(groupLayout.midWordBreaks, "group label breaks inside a word").toEqual([]);

      await row.getByRole("button", { name: `Mount ${DISK_NAME}` }).click();
      const dialog = page.getByRole("dialog", { name: `Mount ${DISK_NAME}` });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(400);
      await capture(page, `${profile}-mount-dialog`);
      const dialogTitle = dialog.getByRole("heading", { name: `Mount ${DISK_NAME}` });
      const [titleBox, closeBox] = await Promise.all([
        dialogTitle.boundingBox(),
        dialog.getByRole("button", { name: "Close" }).boundingBox(),
      ]);
      const titleText = await measureText(dialogTitle);
      expect.soft(titleText.midWordBreaks, "dialog title breaks inside a word").toEqual([]);
      const titleScrollWidth = await dialogTitle.evaluate((element) => element.scrollWidth);
      expect
        .soft(titleBox!.x + titleScrollWidth, "dialog title runs under the close button")
        .toBeLessThanOrEqual(closeBox!.x + 1);

      await dialog.getByRole("button", { name: /Drive A/ }).click();
      await expect(dialog).toBeHidden();
      const card = page.getByTestId("drive-card-a");
      const mountedLabel = page.getByTestId("drive-mounted-label-a");
      await expect(mountedLabel).toHaveText(DISK_NAME);
      await expect(card.getByRole("button", { name: "Drive A next disk" })).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await capture(page, `${profile}-drive-card`);
      const mountedLayout = await measureText(mountedLabel);
      expect
        .soft(mountedLayout.width, "mounted disk name width vs drive card width")
        .toBeGreaterThanOrEqual((await widthOf(card)) * 0.5);
      expect.soft(mountedLayout.midWordBreaks, "mounted disk name breaks inside a word").toEqual([]);
    });
  }
});
