/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { saveCoverageFromPage } from "./withCoverage";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { installListPreviewLimit } from "./visualSeeds";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

const TUNE_COUNT = 20;

/** Messages the app logged, newest first. */
const appLogMessages = async (page: Page) =>
  page.evaluate(() =>
    (JSON.parse(localStorage.getItem("c64u_app_logs") ?? "[]") as Array<{ message: string }>).map(
      (entry) => entry.message,
    ),
  );

/** A playlist a SID Radio station was playing, and the station itself, as a relaunch finds them. */
const seedStationPlaylist = async (page: Page) => {
  await page.addInitScript((count: number) => {
    const items = Array.from({ length: count }, (_, index) => ({
      source: "ultimate",
      path: `/Usb0/Radio/tune-${index + 1}.sid`,
      name: `tune-${index + 1}.sid`,
      durationMs: 180_000,
    }));
    const payload = { items, currentIndex: 0 };
    localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify(payload));
    localStorage.setItem("c64u_playlist:v1:default", JSON.stringify(payload));
    localStorage.setItem("c64u_last_device_id", "TEST-123");
    localStorage.setItem("c64u_sid_radio_enabled", "1");
    localStorage.setItem("c64u_feature_flag:keypad_input_enabled", "1");
    localStorage.setItem(
      "c64u_sid_radio_session",
      JSON.stringify({
        seedKind: "style",
        seedLabel: "Chill / Ambient",
        seed: { kind: "style", styleBit: 0 },
        styleFilter: 0,
        shuffleSeed: 777,
        rankingSnapshotId: "snap",
        excludeOrdinals: [],
      }),
    );
  }, TUNE_COUNT);
};

test.describe("Re-selecting the current tab", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState, {}, { timingMode: "fast" });
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  // R5-5: every re-selection remounted Play, and the resumed station topped the still-empty queue up with 10 tunes.
  test("leaves a SID Radio playlist unchanged when the Play tab is tapped or jumped to again", async ({
    page,
  }, testInfo: TestInfo) => {
    await seedStationPlaylist(page);
    await installListPreviewLimit(page, 100);
    await page.goto("/play");
    const rows = page.getByTestId("playlist-item");
    await expect(rows).toHaveCount(TUNE_COUNT);
    await expect(page.getByTestId("sid-radio-chip")).toBeVisible();

    const heading = page.getByRole("heading", { name: "Play", exact: true });
    // Each re-selection opens the page afresh; the marker on the old heading proves this one is a new page.
    const reselect = async (how: () => Promise<void>) => {
      await heading.evaluate((element) => element.setAttribute("data-before-reselect", ""));
      await how();
      await expect(heading).not.toHaveAttribute("data-before-reselect", "");
      await expect(rows).toHaveCount(TUNE_COUNT);
    };
    for (let round = 0; round < 2; round += 1) {
      await reselect(() => page.getByTestId("tab-play").click());
      await reselect(async () => {
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("2");
      });
    }
    // A top-up runs on the worker, so give one the time to land before judging that none did.
    await page.waitForTimeout(2_000);

    await expect(rows).toHaveCount(TUNE_COUNT);
    // No corpus loads in the browser build, so a top-up asked for here fails instead of appending. The request is
    // the defect: the queue holds 19 tunes past the current one, far above the refill threshold.
    expect((await appLogMessages(page)).filter((message) => message.includes("lookahead refill"))).toEqual([]);
    expect(server.sidplayRequests).toHaveLength(0);
    await attachStepScreenshot(page, testInfo, "play-reselected");
  });

  // The remount re-owned the volume session before the playback session was restored, so the page's "playback ended"
  // effect saw the initial stopped state and wrote the pre-playback mixer levels mid-tune, unmuting the C64.
  test("keeps the C64 muted when the Play tab is re-selected during a muted tune", async ({
    page,
  }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      const payload = {
        items: [{ source: "ultimate", path: "/Usb0/Demos/long.sid", name: "long.sid", durationMs: 600_000 }],
        currentIndex: -1,
      };
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify(payload));
      localStorage.setItem("c64u_playlist:v1:default", JSON.stringify(payload));
      localStorage.setItem("c64u_last_device_id", "TEST-123");
    });
    await page.goto("/play");
    await page.getByTestId("playlist-play").click();
    await expect.poll(() => server.sidplayRequests.length).toBe(1);
    const mute = page.getByTestId("volume-mute");
    await mute.click();
    await expect(mute).toHaveAttribute("aria-label", "Unmute");
    const mixerLevels = () =>
      Object.fromEntries(
        Object.entries(server.getState()["Audio Mixer"]).map(([name, item]) => [
          name,
          (item as { value: unknown }).value,
        ]),
      );
    await expect
      .poll(() => [mixerLevels()["Vol Socket 1"], mixerLevels()["Vol Socket 2"], mixerLevels()["Vol UltiSid 2"]])
      .toEqual(["-42 dB", "-42 dB", "-42 dB"]);
    const muted = mixerLevels();

    for (let round = 0; round < 2; round += 1) {
      await page.getByTestId("tab-play").click();
      await expect(page.getByTestId("playlist-play")).toHaveAttribute("aria-label", "Stop");
    }
    await page.waitForTimeout(2_000);

    expect(mixerLevels()).toEqual(muted);
    expect(server.sidplayRequests).toHaveLength(1);
    await attachStepScreenshot(page, testInfo, "muted-after-reselect");
  });
});
