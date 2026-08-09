/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { expect, test, type Page } from "@playwright/test";

import { createMockC64Server, type ConfigItemState } from "../tests/mocks/mockC64Server";
import { seedFtpConfig, startFtpTestServers } from "./ftpTestUtils";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

const PALETTE_CATEGORY = "U64 Specific Settings";
const PALETTE_ITEM = "Palette Definition";

test.describe("device VIC palette", () => {
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
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

  const start = async (page: Page, palette: string) => {
    const state: Record<string, Record<string, ConfigItemState>> = {
      [PALETTE_CATEGORY]: {
        [PALETTE_ITEM]: {
          value: palette,
          details: { presets: ["", "/Usb0/Demos/device-palette.vpl"] },
        },
      },
    };
    server = await createMockC64Server(state);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
    });
    await seedUiMocks(page, server.baseUrl);
  };

  test("uses the configured VPL automatically and keeps a manual override", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "/Usb0/Demos/device-palette.vpl");
    await page.goto("/settings");

    const palette = page.getByTestId("settings-vic-palette");
    await expect(palette).toContainText("Device palette");
    await expect(page.getByTestId("settings-vic-palette-description")).toContainText(
      "Test palette supplied by the configured U64 VPL",
    );
    await expect(page.getByTestId("settings-vic-palette-swatch-2")).toHaveAttribute("style", /rgb\(18, 52, 86\)/);

    await palette.click();
    await page.getByRole("option", { name: "Monochrome" }).click();
    await expect(page.getByTestId("settings-vic-palette-description")).toContainText("Classic monochrome");
    await expect(page.getByTestId("settings-vic-palette-swatch-2")).toHaveAttribute("style", /rgb\(144, 144, 144\)/);
  });

  test("falls back to Default without FTP when no VPL is selected", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "");
    let ftpReads = 0;
    await page.route("**/v1/ftp/read", async (route) => {
      ftpReads += 1;
      await route.continue();
    });
    await page.goto("/settings");

    await expect(page.getByTestId("settings-vic-palette")).toContainText("Device palette");
    await expect(page.getByTestId("settings-vic-palette-description")).toContainText("C64 Ultimate Default Palette");
    await expect(page.getByTestId("settings-vic-palette-swatch-2")).toHaveAttribute("style", /rgb\(141, 47, 52\)/);
    expect(ftpReads).toBe(0);
  });

  test("falls back to the firmware default without FTP when its palette setting cannot be determined", async ({
    page,
  }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "/Usb0/Demos/device-palette.vpl");
    let ftpReads = 0;
    await page.route("**/v1/ftp/read", async (route) => {
      ftpReads += 1;
      await route.continue();
    });
    await page.route("**/v1/configs/U64%20Specific%20Settings/Palette%20Definition", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
    await page.goto("/settings");

    await expect(page.getByTestId("settings-vic-palette-description")).toContainText("C64 Ultimate Default Palette");
    await expect(page.getByTestId("settings-vic-palette-swatch-2")).toHaveAttribute("style", /rgb\(141, 47, 52\)/);
    expect(ftpReads).toBe(0);
  });

  test("falls back to Default when the configured VPL cannot be retrieved", async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await start(page, "/Usb0/Demos/missing-palette.vpl");
    await page.route("**/v1/ftp/read", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
    await page.goto("/settings");

    await expect(page.getByTestId("settings-vic-palette")).toContainText("Device palette");
    await expect(page.getByTestId("settings-vic-palette-description")).toContainText("C64 Ultimate Default Palette");
    await expect(page.getByTestId("settings-vic-palette-swatch-2")).toHaveAttribute("style", /rgb\(141, 47, 52\)/);
  });
});
