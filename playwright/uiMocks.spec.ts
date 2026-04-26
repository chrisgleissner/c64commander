/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { expect, test } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedFtpConfig, startFtpTestServers } from "./ftpTestUtils";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { saveCoverageFromPage } from "./withCoverage";

test.describe("UI mock bootstrapping", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
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

  test("preserves seeded FTP port when saved devices are bootstrapped", async ({ page }) => {
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: "",
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const savedDeviceState = await page.evaluate(() => {
      const raw = localStorage.getItem("c64u_saved_devices:v1");
      return raw ? (JSON.parse(raw) as { devices?: Array<{ ftpPort?: number }> }) : null;
    });

    expect(savedDeviceState?.devices?.[0]?.ftpPort).toBe(ftpServers.ftpServer.port);
  });

  test("updates saved-device FTP port when FTP is seeded after UI mocks", async ({ page }) => {
    await seedUiMocks(page, server.baseUrl);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: "",
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const savedDeviceState = await page.evaluate(() => {
      const raw = localStorage.getItem("c64u_saved_devices:v1");
      return raw ? (JSON.parse(raw) as { devices?: Array<{ ftpPort?: number }> }) : null;
    });

    expect(savedDeviceState?.devices?.[0]?.ftpPort).toBe(ftpServers.ftpServer.port);
  });
});
