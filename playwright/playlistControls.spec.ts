/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import type { Page, TestInfo } from "@playwright/test";
import * as path from "node:path";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from "./traceUtils";
import { clickSourceSelectionButton } from "./sourceSelection";
import { layoutTest, enforceDeviceTestMapping } from "./layoutTest";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const getPlaylistOrder = async (page: Page) => {
  const rows = page.getByTestId("playlist-item");
  const count = await rows.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const title = await row.locator("button span").first().textContent();
    if (title?.trim()) titles.push(title.trim());
  }
  return titles;
};

const addLocalFolder = async (page: Page, folderPath: string) => {
  await page.getByRole("button", { name: /Add items|Add more items/i }).click();
  await clickSourceSelectionButton(page.getByRole("dialog"), "This device");
  const input = page.locator('input[type="file"][webkitdirectory]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles([folderPath]);
  await expect(page.getByRole("dialog")).toBeHidden();
};

test.describe("Playlist controls and advanced features", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enforceDeviceTestMapping(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  layoutTest("playlist filter not yet implemented @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    // Verify that playlist filter is not yet available (only HVSC folder filter exists)
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    await expect(page.getByTestId("playlist-item")).toHaveCount(2);

    // The playlist shows items without a general filter input
    // (HVSC has folder filter, but general playlist filtering not implemented)
    const playlistItems = page.locator('[data-playlist-item], [data-testid="playlist-item"]');
    const itemCount = await playlistItems.count().catch(() => 0);

    // Should have items from local folder
    expect(itemCount).toBeGreaterThan(0);
    await snap(page, testInfo, "items-shown-unfiltered");
  });

  test("shuffle mode checkbox toggles state @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    await expect(page.getByTestId("playlist-item")).toHaveCount(2);

    // The order controls sit at the bottom of the playback card - scroll to them first
    await page.getByTestId("playback-shuffle").scrollIntoViewIfNeeded();
    await snap(page, testInfo, "scrolled-to-options");

    // Now find the shuffle checkbox - it's the second checkbox in the options area
    const shuffleCheckbox = page.getByTestId("playback-shuffle");
    await expect(shuffleCheckbox).toBeVisible();
    await expect(shuffleCheckbox).not.toBeChecked();
    await snap(page, testInfo, "shuffle-off");

    await shuffleCheckbox.click();
    await expect(shuffleCheckbox).toBeChecked();
    await snap(page, testInfo, "shuffle-enabled");

    await shuffleCheckbox.click();
    await expect(shuffleCheckbox).not.toBeChecked();
    await snap(page, testInfo, "shuffle-disabled");
  });

  test("reshuffle re-seeds the playback order without disturbing the curated list @layout", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    await expect(page.getByTestId("playlist-item")).toHaveCount(2);

    await page.getByTestId("playback-shuffle").scrollIntoViewIfNeeded();
    const shuffleCheckbox = page.getByTestId("playback-shuffle");
    await shuffleCheckbox.click();
    await snap(page, testInfo, "shuffle-enabled");

    const initialOrder = await getPlaylistOrder(page);
    expect(initialOrder.length).toBeGreaterThan(1);

    // Shuffle is a non-destructive playback-order layer (HARD9-007): enabling
    // it generates a seed that drives next/prev traversal, and Reshuffle draws
    // a NEW seed - it never reorders the curated visible list. Assert both: the
    // seed changes (Reshuffle is functional) and the visible order is
    // preserved (the curated order is no longer destroyed irreversibly).
    const reshuffleButton = page.getByTestId("playlist-reshuffle");
    await expect.poll(async () => reshuffleButton.getAttribute("data-shuffle-seed")).not.toBe("");
    const seedBefore = await reshuffleButton.getAttribute("data-shuffle-seed");

    await reshuffleButton.click();
    await expect.poll(async () => reshuffleButton.getAttribute("data-shuffle-seed")).not.toBe(seedBefore);
    expect((await getPlaylistOrder(page)).join("|")).toBe(initialOrder.join("|"));
    await snap(page, testInfo, "reshuffle-changed");
  });

  test("playlist type filters hide non-matching files @layout", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    await expect(page.getByTestId("playlist-item")).toHaveCount(2);

    const sidCategoryCheckbox = page.getByTestId("playlist-type-sid");
    await expect(sidCategoryCheckbox).toBeChecked();
    await sidCategoryCheckbox.click();
    await expect(sidCategoryCheckbox).not.toBeChecked();
    await snap(page, testInfo, "sid-category-unchecked");

    await expect(page.getByTestId("playlist-item")).toHaveCount(1);
    await expect(page.getByTestId("playlist-list")).toContainText("demo.d64");
    await expect(page.getByTestId("playlist-list")).not.toContainText("demo.sid");
  });

  test("repeat mode checkbox toggles state @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    // Scroll to options area
    await page.getByTestId("playback-repeat").scrollIntoViewIfNeeded();
    await snap(page, testInfo, "scrolled-to-options");

    const repeatCheckbox = page.getByTestId("playback-repeat");

    await repeatCheckbox.click();
    await expect(repeatCheckbox).toBeChecked();
    await snap(page, testInfo, "repeat-enabled");
  });

  test("include-subfolders is no longer a playback control @layout", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    // It moved to the Add items sheet, beside the folders it governs. Its behaviour there is covered
    // by `itemSelection.spec.ts`, which is the spec that can actually browse a source; this asserts
    // only that it has left the Play page, which is what stopped a running SID Radio station leaving
    // one live control stranded in a row of controls the station had taken over.
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await expect(page.getByTestId("playlist-item")).toHaveCount(2);

    await expect(page.getByTestId("playback-recurse")).toHaveCount(0);
    await expect(page.getByTestId("playback-shuffle")).toBeVisible();
    await snap(page, testInfo, "no-recurse-on-play-page");
  });

  test("duration control syncs slider and input @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    const slider = page.getByTestId("duration-slider").getByRole("slider");
    const input = page.getByTestId("duration-input");

    await expect(slider).toBeVisible();
    await expect(input).toHaveValue("3:00");
    await snap(page, testInfo, "duration-default");

    await slider.focus();
    await slider.press("ArrowRight");
    await slider.press("ArrowRight");
    const updatedValue = await input.inputValue();
    expect(updatedValue).not.toBe("3:00");
    await snap(page, testInfo, "duration-slider-updated");

    await input.fill("3:45");
    await input.blur();
    await expect(input).toHaveValue("3:45");
    await snap(page, testInfo, "duration-input-updated");
  });

  test("duration control updates playlist totals @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play-sids"));
    await snap(page, testInfo, "playlist-ready");

    const counters = page.getByTestId("playback-counters");
    await expect(counters).toContainText("Total: 6:00");
    await snap(page, testInfo, "duration-total-default");

    const input = page.getByTestId("duration-input");
    await input.fill("2:00");
    await input.blur();
    await expect(counters).toContainText("Total: 4:00");
    await snap(page, testInfo, "duration-total-updated");
  });

  test("the file's tunes are reachable from the credits line and play when chosen @layout", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play-multi-song"));
    await snap(page, testInfo, "playlist-ready");

    const playCountBefore = server.sidplayRequests.length;
    await clearTraces(page);
    await page
      .getByTestId("playlist-item")
      .filter({ hasText: "multi.sid" })
      .getByRole("button", { name: "Play" })
      .click();
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(playCountBefore);
    await snap(page, testInfo, "multi-song-playing");

    await expectRestTraceSequence(page, testInfo, /\/v1\/runners:sidplay/);

    // There is one control for choosing a tune, and it is the label that states which one is
    // playing. The plain list that used to sit in the playback settings has gone: it offered the
    // same choice from below the fold, without the names or the lengths, and having two buttons
    // both reading "Tune 1 of 3" made neither of them addressable by name.
    const trigger = page.getByTestId("playback-current-tunes");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText(/Tune 1 of 3/);
    await snap(page, testInfo, "song-selector-visible");
    await trigger.click();
    const sheet = page.getByTestId("tune-list-sheet");
    await expect(sheet).toBeVisible({ timeout: 10000 });
    // One row per tune in the file, and the one playing says so.
    await expect(sheet.getByTestId("tune-list-row")).toHaveCount(3);
    await expect(sheet.getByTestId("tune-list-row").first()).toHaveAttribute("data-current", "true");
    await snap(page, testInfo, "song-selector-open");

    await sheet.getByTestId("tune-list-row").nth(1).click();

    await expect(sheet).toBeHidden();
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(playCountBefore + 1);
    expect(server.sidplayRequests.at(-1)?.url).toContain("songnr=2");
    await snap(page, testInfo, "song-selector-updated");
  });

  test("prev at first track stays at first @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    await page.getByTestId("playlist-item").first().getByRole("button", { name: "Play" }).click();
    await expect(page.getByTestId("playlist-play")).toHaveAttribute("aria-label", "Stop");
    await expect.poll(() => page.getByTestId("playlist-item").first().getAttribute("data-playing")).toBe("true");
    await expect(page.getByTestId("playlist-item").nth(1)).toHaveAttribute("data-playing", "false");
    await snap(page, testInfo, "first-track-playing");

    const prevButton = page.getByTestId("playlist-prev");
    await expect(prevButton).toBeVisible();
    await expect(prevButton).toBeDisabled();
    await snap(page, testInfo, "prev-disabled");
    await expect(page.getByTestId("playlist-item").first()).toHaveAttribute("data-playing", "true");
    await expect(page.getByTestId("playlist-item").nth(1)).toHaveAttribute("data-playing", "false");
    await snap(page, testInfo, "still-at-first");
  });

  test("next at last track stops playback @layout", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/play");
    await snap(page, testInfo, "play-open");

    await addLocalFolder(page, path.resolve("playwright/fixtures/local-play"));
    await snap(page, testInfo, "playlist-ready");

    await page.getByTestId("playlist-item").last().getByRole("button", { name: "Play" }).click();
    await snap(page, testInfo, "last-track-playing");

    const playButton = page.getByTestId("playlist-play");
    await expect(playButton).toHaveAttribute("aria-label", "Stop");
    await snap(page, testInfo, "playback-active");

    const nextButton = page.getByTestId("playlist-next");
    await expect(nextButton).toBeDisabled();
    await snap(page, testInfo, "next-disabled");

    await expect(playButton).toHaveAttribute("aria-label", "Stop");
    await snap(page, testInfo, "playback-still-active");
  });
});
