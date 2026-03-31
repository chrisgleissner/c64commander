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
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { createMockArchiveServer } from "./mockArchiveServer";

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

const createSidBytes = () => {
  const bytes = new Uint8Array(0x78);
  bytes.set([0x50, 0x53, 0x49, 0x44], 0);
  bytes.set([0x00, 0x02], 4);
  bytes.set([0x00, 0x76], 6);
  bytes.set([0x00, 0x01], 0x0e);
  bytes.set([0x00, 0x01], 0x10);
  return bytes;
};

const openCommoServePicker = async (page: Page) => {
  await page.getByRole("button", { name: /Add items|Add more items/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("import-option-commoserve").click();
  const picker = dialog.getByTestId("commoserve-picker");
  await expect(picker).toBeVisible();
  return { dialog, picker };
};

const searchArchive = async (page: Page, term: string) => {
  const { dialog, picker } = await openCommoServePicker(page);
  await picker.getByLabel("Name").fill(term);
  await picker.getByTestId("archive-search-button").click();
  await expect(picker.getByTestId("archive-result-row")).toHaveCount(1);
  return { dialog, picker };
};

const addSearchResultToPlaylist = async (page: Page, resultName: string) => {
  const { dialog } = await searchArchive(page, resultName.toLowerCase());
  await dialog.getByRole("checkbox", { name: new RegExp(`^Select ${resultName}$`) }).click();
  await dialog.getByTestId("add-items-confirm").click();
  await expect(dialog).toBeHidden();
};

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe("CommoServe Play page", () => {
  test("downloads an archive SID result and starts playback", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    const c64Server = await createMockC64Server({});
    const archiveServer = await createMockArchiveServer({
      searchByQuery: {
        '(name:"joyride")': [
          { id: "100", category: 40, name: "Joyride", group: "Protovision", year: 2024, updated: "2024-03-14" },
        ],
      },
      entriesByResultKey: {
        "100:40": [{ path: "joyride.sid", id: 0, size: createSidBytes().byteLength, date: 1710374400000 }],
      },
      binariesByEntryKey: {
        "100:40:0": createSidBytes(),
      },
    });

    try {
      await page.addInitScript((archiveHost: string) => {
        localStorage.setItem("c64u_archive_host_override", archiveHost);
      }, archiveServer.host);
      await seedUiMocks(page, c64Server.baseUrl);

      await page.goto("/play");
      await addSearchResultToPlaylist(page, "Joyride");
      const row = page.getByTestId("playlist-item").filter({ hasText: "Joyride" }).first();
      await expect(row).toBeVisible();
      await snap(page, testInfo, "commoserve-sid-ready");

      await row.getByRole("button", { name: "Play" }).click();

      await waitForRequests(() =>
        archiveServer.requests.some((req) => req.url.startsWith("/leet/search/bin/100/40/0")),
      );
      await waitForRequests(() => c64Server.requests.some((req) => req.url.startsWith("/v1/runners:sidplay")));

      await expect(page.getByTestId("playback-current-track")).toContainText("Joyride");
      await snap(page, testInfo, "commoserve-sid-playing");
    } finally {
      try {
        await saveCoverageFromPage(page, testInfo.title);
        await assertNoUiIssues(page, testInfo);
      } finally {
        await finalizeEvidence(page, testInfo);
        await archiveServer.close();
        await c64Server.close();
      }
    }
  });

  test("downloads an archive D64 result and mounts it with autostart", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    const c64Server = await createMockC64Server({});
    const archiveServer = await createMockArchiveServer({
      searchByQuery: {
        '(name:"diskdemo")': [
          { id: "200", category: 40, name: "DiskDemo", group: "Scene Org", year: 2024, updated: "2024-03-14" },
        ],
      },
      entriesByResultKey: {
        "200:40": [{ path: "diskdemo.d64", id: 0, size: 174848, date: 1710374400000 }],
      },
      binariesByEntryKey: {
        "200:40:0": new Uint8Array(174848),
      },
    });

    try {
      await page.addInitScript((archiveHost: string) => {
        localStorage.setItem("c64u_archive_host_override", archiveHost);
      }, archiveServer.host);
      await seedUiMocks(page, c64Server.baseUrl);

      await page.goto("/play");
      await addSearchResultToPlaylist(page, "DiskDemo");
      const row = page.getByTestId("playlist-item").filter({ hasText: "DiskDemo" }).first();
      await expect(row).toBeVisible();
      await snap(page, testInfo, "commoserve-d64-ready");

      await row.getByRole("button", { name: "Play" }).click();

      await waitForRequests(() =>
        archiveServer.requests.some((req) => req.url.startsWith("/leet/search/bin/200/40/0")),
      );
      await waitForRequests(() => c64Server.requests.some((req) => req.url.startsWith("/v1/drives/a:mount")));
      await waitForRequests(() => c64Server.requests.some((req) => req.url.startsWith("/v1/machine:writemem")));

      await expect(page.getByTestId("playlist-play")).toHaveAttribute("aria-label", "Stop");
      await snap(page, testInfo, "commoserve-d64-mounted");
    } finally {
      try {
        await saveCoverageFromPage(page, testInfo.title);
        await assertNoUiIssues(page, testInfo);
      } finally {
        await finalizeEvidence(page, testInfo);
        await archiveServer.close();
        await c64Server.close();
      }
    }
  });
});
