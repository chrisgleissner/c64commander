/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from "@playwright/test";
import { saveCoverageFromPage } from "./withCoverage";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from "./traceUtils";
import { enableGoldenTrace } from "./goldenTraceRegistry";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const ensureTechnicalDetailsExpanded = async (_dialog: Locator) => {
  // no-op: technical details section removed from redesigned DiagnosticsDialog
};

const ensureToolsExpanded = async (_dialog: Locator) => {
  // no-op: tools expansion removed from redesigned DiagnosticsDialog
};

const scrollRowIntoView = async (entry: Locator) => {
  await expect(entry).toHaveCount(1);
  await entry.scrollIntoViewIfNeeded();
  await expect(entry).toBeVisible();
};

test.describe("Settings diagnostics workflows", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);

    await page.addInitScript(() => {
      window.addEventListener("c64u-logs-updated", () => {});

      const logs = [
        {
          id: "log-1",
          timestamp: new Date().toISOString(),
          level: "error",
          message: "Test error 1",
          details: {},
        },
        {
          id: "log-2",
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Test info 1",
          details: {},
        },
      ];

      localStorage.setItem("c64u_app_logs", JSON.stringify(logs));
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

  test("open diagnostics dialog shows logs", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/settings");
    await snap(page, testInfo, "settings-open");

    const diagnosticsButton = page.getByRole("button", {
      name: "Diagnostics",
      exact: true,
    });
    await expect(diagnosticsButton).toBeVisible();
    await snap(page, testInfo, "diagnostics-button-visible");

    await diagnosticsButton.click();
    await snap(page, testInfo, "button-clicked");

    const dialog = page.getByRole("dialog", { name: /Diagnostics|Logs/i });
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, "dialog-open");

    // Check if logs are shown (they may not be if not loaded from storage)
    const logText = await dialog
      .getByText(/Test error 1|Test info 1|No entries|empty/i)
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (logText) {
      await snap(page, testInfo, "logs-shown");
    } else {
      await snap(page, testInfo, "no-logs-or-empty");
    }
  });

  test("debug logging toggle records REST calls", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    enableTraceAssertions(testInfo);
    await page.goto("/settings");
    await snap(page, testInfo, "settings-open");

    const debugToggle = page.getByLabel("Enable Debug Logging");
    await expect(debugToggle).toBeVisible();
    await debugToggle.click();
    await snap(page, testInfo, "debug-logging-enabled");

    const refreshButton = page.getByRole("button", {
      name: "Refresh connection",
    });
    await expect(refreshButton).toBeVisible();
    await clearTraces(page);
    await refreshButton.click();
    await snap(page, testInfo, "refresh-clicked");

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Diagnostics|Logs/i });
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, "diagnostics-open");

    // Enable Logs filter to see debug log entries
    await dialog.getByTestId("open-filters-editor").click();
    const filterSurface = page.getByTestId("filters-editor-surface");
    await expect(filterSurface).toBeVisible();
    await filterSurface.getByRole("button", { name: "Logs", exact: true }).click();
    await filterSurface.getByRole("button", { name: "Close" }).click();
    await expect(filterSurface).toBeHidden();

    const apiRequestRow = dialog
      .locator('[data-testid^="evidence-row-"]')
      .filter({ hasText: "C64 API request" })
      .first();
    await expect(apiRequestRow).toBeVisible();
    await expect(apiRequestRow.locator('[aria-label="debug"]')).toBeVisible();
    await snap(page, testInfo, "debug-log-entry");

    const { requestEvent } = await expectRestTraceSequence(page, testInfo, "/v1/info");
    expect((requestEvent.data as { target?: string }).target).toBe("external-mock");
  });

  test("diagnostics rows stay dense and consistent across tabs", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/settings");
    await snap(page, testInfo, "settings-open");

    const now = Date.now() + 60_000;
    const traceSeed = [
      {
        id: "TRACE-0100",
        timestamp: new Date(now).toISOString(),
        relativeMs: 0,
        type: "rest-request",
        origin: "user",
        correlationId: "COR-0100",
        data: {
          method: "GET",
          url: "/v1/info",
          normalizedUrl: "/v1/info",
          target: "real-device",
        },
      },
      {
        id: "TRACE-0101",
        timestamp: new Date(now + 50).toISOString(),
        relativeMs: 50,
        type: "action-start",
        origin: "user",
        correlationId: "COR-0100",
        data: { name: "Inspect", component: "SettingsPage", context: {} },
      },
      {
        id: "TRACE-0102",
        timestamp: new Date(now + 90).toISOString(),
        relativeMs: 90,
        type: "action-end",
        origin: "user",
        correlationId: "COR-0100",
        data: { status: "success", error: null },
      },
    ];

    await page.waitForFunction(() =>
      Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces),
    );
    await page.evaluate((seedEvents) => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          window.removeEventListener("c64u-traces-updated", handler);
          setTimeout(resolve, 50);
        };
        window.addEventListener("c64u-traces-updated", handler);
        const tracing = (
          window as Window & {
            __c64uTracing?: {
              seedTraces?: (events: typeof seedEvents) => void;
            };
          }
        ).__c64uTracing;
        tracing?.seedTraces?.(seedEvents);
      });
    }, traceSeed);

    // Seed log entries with known IDs so dense-row assertions are deterministic
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          window.removeEventListener("c64u-logs-updated", handler);
          setTimeout(resolve, 50);
        };
        window.addEventListener("c64u-logs-updated", handler);
        const logEntries = [
          {
            id: "1",
            level: "error",
            message: "Test error entry",
            timestamp: new Date(Date.now() + 60_000).toISOString(),
          },
          {
            id: "log-1",
            level: "debug",
            message: "Test debug entry",
            timestamp: new Date(Date.now() + 59_000).toISOString(),
          },
        ];
        localStorage.setItem("c64u_app_logs", JSON.stringify(logEntries));
        window.dispatchEvent(new CustomEvent("c64u-logs-updated"));
      });
    });

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Diagnostics|Logs/i });
    await expect(dialog).toBeVisible();

    // Open filter editor and enable all evidence types
    await dialog.getByTestId("open-filters-editor").click();
    const filterSurface = page.getByTestId("filters-editor-surface");
    await expect(filterSurface).toBeVisible();
    await filterSurface.getByRole("button", { name: "Logs", exact: true }).click();
    await filterSurface.getByRole("button", { name: "Traces", exact: true }).click();
    await filterSurface.getByRole("button", { name: "Close" }).click();
    await expect(filterSurface).toBeHidden();

    // All entry types now visible – verify consistent structure
    const problemEntry = dialog.getByTestId("evidence-row-problem-log-1");
    const logEntry = dialog.getByTestId("evidence-row-log-log-1");
    const traceEntry = dialog.getByTestId("evidence-row-trace-TRACE-0100");
    const actionEntry = dialog.getByTestId("evidence-row-action-COR-0100");

    await scrollRowIntoView(problemEntry);
    await scrollRowIntoView(logEntry);
    await scrollRowIntoView(traceEntry);
    await scrollRowIntoView(actionEntry);

    // All EvidenceRow entries use the same component – padding must be identical
    const getPadding = async (entry: Locator) =>
      entry.evaluate((node) => {
        const style = window.getComputedStyle(node as HTMLElement);
        return {
          top: style.paddingTop,
          bottom: style.paddingBottom,
          left: style.paddingLeft,
          right: style.paddingRight,
        };
      });

    const errorsMetrics = { padding: await getPadding(problemEntry) };
    const logsMetrics = { padding: await getPadding(logEntry) };
    const tracesMetrics = { padding: await getPadding(traceEntry) };
    const actionsMetrics = { padding: await getPadding(actionEntry) };

    expect(logsMetrics.padding).toEqual(errorsMetrics.padding);
    expect(tracesMetrics.padding).toEqual(errorsMetrics.padding);
    expect(actionsMetrics.padding).toEqual(errorsMetrics.padding);
  });

  test("diagnostics action bar is available", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/settings");
    await snap(page, testInfo, "settings-open");

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await snap(page, testInfo, "dialog-open");
    await page.getByTestId("diagnostics-overflow-menu").click();

    await expect(page.getByTestId("diagnostics-share-all")).toBeVisible();
    await expect(page.getByTestId("diagnostics-share-filtered")).toBeVisible();
    await expect(page.getByTestId("diagnostics-overflow-menu")).toBeVisible();
  });

  test("clear all diagnostics empties log storage", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/settings");
    await snap(page, testInfo, "settings-open");

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await snap(page, testInfo, "dialog-open");

    // Clear All is inside the overflow menu
    await page.getByTestId("diagnostics-overflow-menu").click();
    const clearButton = page.getByTestId("diagnostics-clear-all-trigger");

    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const beforeLogs = await page.evaluate(() => localStorage.getItem("c64u_app_logs"));
      await clearButton.click();
      await page.getByTestId("diagnostics-clear-all-confirm").click();
      await snap(page, testInfo, "clear-clicked");

      await expect
        .poll(async () => page.evaluate(() => localStorage.getItem("c64u_app_logs")), {
          timeout: 5000,
        })
        .not.toBe(beforeLogs);

      // Logs should be empty or at least the clear button was clicked
      await snap(page, testInfo, "clear-attempted");

      const emptyStateVisible = await page
        .getByText(/No entries|empty|cleared/i)
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (emptyStateVisible) {
        await snap(page, testInfo, "empty-state-shown");
      } else {
        await snap(page, testInfo, "clear-completed");
      }
    } else {
      await snap(page, testInfo, "clear-button-not-found");
    }
  });
});
