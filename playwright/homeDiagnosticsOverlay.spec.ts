/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { seedFtpConfig, startFtpTestServers, type FtpTestServers } from "./ftpTestUtils";
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const decodeZip = (zipData: number[]) => {
  const files = unzipSync(new Uint8Array(zipData));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
};

const getUnifiedBadge = (page: Page) => page.locator('[data-panel-position="1"]').getByTestId("unified-health-badge");

const openDiagnosticsOverlay = async (page: Page) => {
  const badge = getUnifiedBadge(page);
  await expect(badge).toBeVisible();
  await badge.evaluate((node) => (node as HTMLButtonElement).click());
  const sheet = page.locator('[data-testid="diagnostics-sheet"][data-state="open"]').last();
  await expect(sheet).toBeVisible();
  return sheet;
};

const ensureTechnicalDetailsExpanded = async (_dialog: Locator) => {
  // no-op: technical details section removed from redesigned DiagnosticsDialog
};

const ensureToolsExpanded = async (_dialog: Locator) => {
  // no-op: tools expansion removed from redesigned DiagnosticsDialog
};

const installShareOverride = async (page: Page) => {
  await page.addInitScript(() => {
    (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads = [];
    (
      window as Window & {
        __c64uDiagnosticsShareOverride?: (payload: {
          filename: string;
          scope: string;
          data: unknown;
          zipData: Uint8Array;
        }) => void;
      }
    ).__c64uDiagnosticsShareOverride = (payload) => {
      const list =
        (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads ?? [];
      list.push({
        ...payload,
        zipData: Array.from(payload.zipData ?? []),
      });
      (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads = list;
    };
  });
};

test.describe("Home diagnostics overlay", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: FtpTestServers;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    ftpServers = await startFtpTestServers();
    await page.route("http://127.0.0.1/**", async (route) => {
      const requestUrl = new URL(route.request().url());
      await route.continue({
        url: `${server.baseUrl}${requestUrl.pathname}${requestUrl.search}`,
      });
    });
    await page.addInitScript(() => {
      const win = window as Window & { __c64uAllowedBaseUrls?: string[] };
      const allowed = new Set(Array.isArray(win.__c64uAllowedBaseUrls) ? win.__c64uAllowedBaseUrls : []);
      allowed.add("http://127.0.0.1");
      win.__c64uAllowedBaseUrls = Array.from(allowed);
    });
    await installShareOverride(page);
    await seedUiMocks(page, server.baseUrl);
    const serverUrl = new URL(server.baseUrl);
    await seedFtpConfig(page, {
      host: serverUrl.hostname,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
    });
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await ftpServers.close();
      await server.close();
    }
  });

  test("opens from the unified badge without navigation or scroll loss", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 480));
    const before = await page.evaluate(() => ({
      path: window.location.pathname,
      scrollY: Math.round(window.scrollY),
    }));

    await openDiagnosticsOverlay(page);
    const whileOpen = await page.evaluate(() => ({
      path: window.location.pathname,
      scrollY: Math.round(window.scrollY),
    }));

    expect(whileOpen.path).toBe(before.path);
    expect(whileOpen.scrollY).toBe(before.scrollY);
    await snap(page, testInfo, "overlay-open-home");
  });

  test("supports health checks, analytics, export enrichment, and clear-all", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    const openOverflowMenu = async () => {
      await dialog.getByTestId("diagnostics-overflow-menu").click();
    };

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const dialog = await openDiagnosticsOverlay(page);

    await expect(dialog).toBeVisible();
    await snap(page, testInfo, "details-open");

    // Run health check via always-visible button
    const runHealthCheckBtn = dialog.getByTestId("run-health-check");
    await expect(runHealthCheckBtn).toBeVisible();
    await runHealthCheckBtn.click();
    // Wait for health check to complete (button re-enables or label reverts)
    await expect(runHealthCheckBtn).not.toHaveText("Running health check", { timeout: 15000 });
    await snap(page, testInfo, "health-check-finished");

    await dialog.getByTestId("open-latency-screen").click();
    const latencyPopup = page.getByTestId("latency-analysis-popup");
    await expect(latencyPopup).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(latencyPopup.getByText(/\d+ samples?/)).toBeVisible();
    await snap(page, testInfo, "latency-popup");
    await latencyPopup.getByRole("button", { name: /Close/i }).click();
    await expect(latencyPopup).toBeHidden();

    await dialog.getByTestId("open-timeline-screen").click();
    const historyPopup = page.getByTestId("health-history-popup");
    await expect(historyPopup).toBeVisible();
    await expect(historyPopup.getByTestId("health-history-zoom-in")).toBeVisible();
    await expect(historyPopup.getByTestId("health-history-track")).toBeVisible();
    await historyPopup.locator('[data-testid^="health-history-segment-"]').last().click();
    await expect(historyPopup.getByTestId("health-history-selection-overlay")).toBeVisible();
    await expect(historyPopup.getByTestId("health-history-selection-reason")).toBeVisible();
    await historyPopup.getByRole("button", { name: "Dismiss" }).click();
    await expect(historyPopup.getByTestId("health-history-selection-overlay")).toBeHidden();
    await snap(page, testInfo, "history-popup");
    await historyPopup.getByRole("button", { name: /Close/i }).click();
    await expect(historyPopup).toBeHidden();

    await openOverflowMenu();
    await dialog.getByTestId("diagnostics-share-all").click();
    const payloads = (await expect
      .poll(async () =>
        page.evaluate(
          () => (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads,
        ),
      )
      .toBeTruthy()) as void;
    void payloads;
    const sharePayloads = (await page.evaluate(
      () => (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads ?? [],
    )) as Array<{ filename: string; zipData: number[] }>;
    const shareAllPayload = sharePayloads[sharePayloads.length - 1];
    expect(shareAllPayload.filename).toMatch(/^c64commander-diagnostics-all-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}Z\.zip$/);
    const zipFiles = decodeZip(shareAllPayload.zipData);
    expect(Object.keys(zipFiles)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^error-logs-/),
        expect.stringMatching(/^logs-/),
        expect.stringMatching(/^traces-/),
        expect.stringMatching(/^actions-/),
        expect.stringMatching(/^supplemental-/),
      ]),
    );
    const supplementalName = Object.keys(zipFiles).find((name) => name.startsWith("supplemental-"));
    expect(supplementalName).toBeTruthy();
    const supplemental = JSON.parse(zipFiles[supplementalName!]) as {
      lastHealthCheckResult?: unknown;
      healthHistory?: unknown[];
      latencySamples?: unknown[];
      recoveryEvidence?: unknown[];
    };
    expect(supplemental.lastHealthCheckResult).toBeTruthy();
    expect(Array.isArray(supplemental.healthHistory)).toBeTruthy();
    expect(Array.isArray(supplemental.latencySamples)).toBeTruthy();
    expect(Array.isArray(supplemental.recoveryEvidence)).toBeTruthy();

    await openOverflowMenu();
    await page.getByTestId("diagnostics-clear-all-trigger").click();
    await page.getByTestId("diagnostics-clear-all-confirm").click();
    await expect(dialog.getByText("No matching evidence.")).toBeVisible();
    await expect(dialog.getByTestId("run-health-check")).toHaveCount(1);
    await snap(page, testInfo, "clear-all");
  });
});
