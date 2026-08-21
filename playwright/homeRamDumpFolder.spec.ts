/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks, uiFixtures } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { attachStepScreenshot, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { enforceDeviceTestMapping } from "./layoutTest";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe("Home quick actions RAM folder display", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enforceDeviceTestMapping(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      const folder = {
        treeUri: "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fc64",
        rootName: "c64",
        selectedAt: new Date().toISOString(),
      };
      localStorage.setItem("c64u_ram_dump_folder:v1", JSON.stringify(folder));
    });
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

  /**
   * Opens the Save RAM dialog, which is where the RAM folder row lives. Where snapshots are written
   * is a property of saving and loading them, not a Quick Action of its own.
   */
  const openSaveRamDialog = async (page: Page) => {
    await page.getByTestId("home-save-ram").click();
    await expect(page.getByTestId("save-ram-dialog")).toBeVisible();
  };

  test("shows the RAM folder trigger in the Save RAM dialog and hides drive summary @layout", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/");
    await snap(page, testInfo, "home-open");

    // "Quick Config" no longer exists as a single wrapper - it dissolved into separate
    // collapsible cards (CPU & RAM, Ports, Video, ...). Quick Actions itself remains the
    // sanity check that the page rendered; the RAM folder row assertion below is the one
    // this test is actually about.
    await expect(page.getByText("Quick Actions")).toBeVisible();
    await expect(page.getByTestId("home-drive-summary")).toHaveCount(0);

    // Not on the page itself any more.
    await expect(page.getByTestId("home-ram-folder-row")).toHaveCount(0);
    await openSaveRamDialog(page);

    const trigger = page.getByTestId("ram-dump-folder-trigger");
    await expect(page.getByTestId("home-ram-folder-row")).toContainText("RAM folder:");
    await expect(trigger).toHaveText("c64");

    await page.evaluate(() => {
      const folder = {
        treeUri: "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Fc64",
        rootName: "c64",
        selectedAt: new Date().toISOString(),
      };
      localStorage.setItem("c64u_ram_dump_folder:v1", JSON.stringify(folder));
      window.dispatchEvent(new CustomEvent("c64u-ram-dump-folder-updated", { detail: folder }));
    });

    await expect(trigger).toHaveText("c64");
    await snap(page, testInfo, "ram-dump-folder");
  });

  test("shows ellipsis before a RAM folder is configured @layout", async ({ page }: { page: Page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("c64u_ram_dump_folder:v1");
    });
    await page.goto("/");
    await openSaveRamDialog(page);

    await expect(page.getByTestId("ram-dump-folder-trigger")).toHaveText("...");
  });
});
