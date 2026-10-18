/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { createMockArchiveServer } from "./mockArchiveServer";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad, ringFocus } from "./focusRing";

/**
 * Two surfaces on the smallest supported screen (320 x 426 CSS px, keypad): the Docs contents and the
 * CommoServe search of the Add items sheet.
 */

const MIN_TARGET_PX = 44;

const boxOf = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} is not rendered`).not.toBeNull();
  return box!;
};

test.describe("compact Docs contents and archive search", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let archive: Awaited<ReturnType<typeof createMockArchiveServer>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout geometry only; no traced user journey.");
    server = await createMockC64Server({});
    archive = await createMockArchiveServer({
      searchByQuery: {
        '(name:"joyride")': [
          { id: "100", category: 40, name: "Joyride", group: "Protovision", year: 2024, updated: "2024-03-14" },
        ],
      },
    });
    await page.addInitScript((host: string) => localStorage.setItem("c64u_archive_host_override", host), archive.host);
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await page.addInitScript(() => localStorage.setItem("c64u_dev_mode_enabled", "0"));
    await page.addInitScript(() => localStorage.setItem("c64u_display_profile_override", "compact"));
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
  });

  test.afterEach(async () => {
    await archive.close();
    await server.close();
  });

  test("Docs opens at the contents, one 44 px entry per row, with the tour below", async ({ page }) => {
    await page.goto("/docs", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("docs-contents-link-getting-started")).toBeVisible();

    const viewportHeight = page.viewportSize()!.height;
    const first = await boxOf(page, "docs-contents-link-getting-started");
    expect(first.y, "the first contents entry is on screen without scrolling").toBeLessThan(viewportHeight / 2);

    const links = page.locator('[data-testid^="docs-contents-link-"]');
    const boxes = await links.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.x), y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(16);
    expect(new Set(boxes.map((box) => box.x)).size, "every entry starts at the same x: one per row").toBe(1);
    for (const box of boxes) {
      expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
      expect(box.width).toBeGreaterThan(250);
    }

    const tour = await boxOf(page, "docs-tour-card");
    expect(tour.y, "the tour card follows the contents").toBeGreaterThan(boxes[boxes.length - 1].y);
    expect((await boxOf(page, "docs-tour-start")).height).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);
    expect(tour.height, "the tour card is one row on this screen").toBeLessThan(80);
  });

  test("archive search shows a plain summary, keeps Search on screen and always shows the license sentence", async ({
    page,
  }) => {
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("import-option-commoserve").click();
    const picker = dialog.getByTestId("commoserve-picker");
    await expect(picker).toBeVisible();

    const search = picker.getByTestId("archive-search-button");
    const viewportHeight = page.viewportSize()!.height;
    const searchBox = async () => (await search.boundingBox())!;
    await expect
      .poll(async () => (await searchBox()).y + (await searchBox()).height, {
        message: "Search is on screen before any scrolling, once the sheet has finished sliding in",
      })
      .toBeLessThanOrEqual(viewportHeight);
    expect((await searchBox()).height).toBeGreaterThanOrEqual(MIN_TARGET_PX - 0.5);

    const notice = await boxOf(page, "archive-legal-notice");
    const body = await boxOf(page, "add-items-scroll");
    expect(notice.y + notice.height, "the license sentence is on the first screen of the sheet").toBeLessThanOrEqual(
      body.y + body.height,
    );
    expect(notice.y, "the license sentence precedes the filters").toBeLessThan(
      (await picker.getByLabel("Name").boundingBox())!.y,
    );

    await picker.getByLabel("Name").fill("joyride");
    await expect(picker.getByTestId("archive-filter-summary")).toHaveText("Name joyride");
    await expect(dialog).not.toContainText("(name:");
    await expect(picker.getByTestId("archive-legal-notice")).toBeVisible();

    await dialog.getByTestId("add-items-scroll").evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    const scrolled = await searchBox();
    expect(scrolled.y + scrolled.height, "Search stays on screen at the bottom of the form").toBeLessThanOrEqual(
      viewportHeight,
    );
    expect(scrolled.y).toBeGreaterThan(0);

    await expect(picker.getByTestId("archive-legal-notice")).toBeVisible();

    expect(await ringFocus(page, search), "the keypad ring can reach Search").toBe(true);
    await page.keyboard.press("Enter");
    await expect(picker.getByTestId("archive-result-row")).toHaveCount(1);
    const row = await boxOf(page, "archive-result-row");
    expect(row.y, "the first result is brought into view").toBeGreaterThanOrEqual(body.y);
    expect(row.y + row.height, "the first result is brought into view").toBeLessThanOrEqual(body.y + body.height);
  });
});
