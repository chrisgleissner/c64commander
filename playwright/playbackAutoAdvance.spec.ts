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
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

const seedPlaylistStorage = async (
  page: Page,
  items: Array<{
    source: "ultimate";
    path: string;
    name: string;
    durationMs: number;
  }>,
) => {
  await page.addInitScript(
    ({ seedItems }: { seedItems: Array<{ source: "ultimate"; path: string; name: string; durationMs: number }> }) => {
      const payload = {
        items: seedItems,
        currentIndex: -1,
      };
      localStorage.setItem("c64u_playlist:v1:TEST-123", JSON.stringify(payload));
      localStorage.setItem("c64u_playlist:v1:default", JSON.stringify(payload));
      localStorage.setItem("c64u_last_device_id", "TEST-123");
    },
    { seedItems: items },
  );
};

const dispatchPlaybackResumeSignals = async (page: Page) => {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe("Playback auto advance", () => {
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

  test("plays three songs in sequence without user interaction", async ({ page }, testInfo) => {
    await seedPlaylistStorage(page, [
      {
        source: "ultimate",
        path: "/Usb0/Demos/track-1.sid",
        name: "track-1.sid",
        durationMs: 1_200,
      },
      {
        source: "ultimate",
        path: "/Usb0/Demos/track-2.sid",
        name: "track-2.sid",
        durationMs: 1_200,
      },
      {
        source: "ultimate",
        path: "/Usb0/Demos/track-3.sid",
        name: "track-3.sid",
        durationMs: 20_000,
      },
    ]);

    await page.goto("/play");
    await page.getByTestId("playlist-play").click();

    await expect.poll(() => server.sidplayRequests.length).toBe(1);
    await expect(page.getByTestId("playback-current-track")).toContainText("track-1.sid");

    await expect
      .poll(async () => {
        if (server.sidplayRequests.length < 3) {
          await dispatchPlaybackResumeSignals(page);
        }
        return server.sidplayRequests.length;
      })
      .toBe(3);

    await expect(page.getByTestId("playback-current-track")).toContainText("track-3.sid");
    await expect(page.getByTestId("playlist-item").filter({ hasText: "track-3.sid" }).first()).toHaveAttribute(
      "data-playing",
      "true",
    );
    await snap(page, testInfo, "auto-advance-three-song-sequence");
  });

  test("repeat mode loops back to the first song after the last track", async ({ page }, testInfo) => {
    await seedPlaylistStorage(page, [
      {
        source: "ultimate",
        path: "/Usb0/Demos/loop-1.sid",
        name: "loop-1.sid",
        durationMs: 1_200,
      },
      {
        source: "ultimate",
        path: "/Usb0/Demos/loop-2.sid",
        name: "loop-2.sid",
        durationMs: 1_200,
      },
      {
        source: "ultimate",
        path: "/Usb0/Demos/loop-3.sid",
        name: "loop-3.sid",
        durationMs: 1_200,
      },
    ]);

    await page.goto("/play");
    await page.getByTestId("playback-repeat").click();
    await page.getByTestId("playlist-play").click();

    await expect
      .poll(async () => {
        if (server.sidplayRequests.length < 4) {
          await dispatchPlaybackResumeSignals(page);
        }
        return server.sidplayRequests.length;
      })
      .toBe(4);

    await expect(page.getByTestId("playback-current-track")).toContainText("loop-1.sid");
    await expect(page.getByTestId("playlist-item").filter({ hasText: "loop-1.sid" }).first()).toHaveAttribute(
      "data-playing",
      "true",
    );
    await snap(page, testInfo, "auto-advance-repeat-wrap");
  });
});
