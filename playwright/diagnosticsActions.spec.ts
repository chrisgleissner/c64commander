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
import type { TraceEvent } from "../src/lib/tracing/types";
import { seedUiMocks } from "./uiMocks";
import { saveCoverageFromPage } from "./withCoverage";
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from "./testArtifacts";

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const waitForTracing = async (page: Page) => {
  await page.waitForFunction(() =>
    Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces),
  );
};

test.describe("Diagnostics Actions tab", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
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

  test("shows action summaries with badges and details", async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await snap(page, testInfo, "settings-open");

    // Reset trace session - start counters high enough that natural events don't reach seeded IDs
    // Natural events from navigation will use EVT-0500+, our seeded events use EVT-0900+
    await page.evaluate(() => {
      const tracing = (
        window as Window & {
          __c64uTracing?: {
            resetTraceSession?: (eventIdStart?: number, correlationIdStart?: number) => void;
          };
        }
      ).__c64uTracing;
      tracing?.resetTraceSession?.(500, 500);
    });

    // Build events with CURRENT timestamps (within retention window)
    // Using EVT-0900+ to avoid any conflict with natural emissions starting at EVT-0500
    const events = (await page.evaluate(() => {
      const now = Date.now();
      return [
        {
          id: "EVT-0900",
          timestamp: new Date(now).toISOString(),
          relativeMs: 0,
          type: "action-start",
          origin: "user",
          correlationId: "COR-0900",
          data: { name: "demo.action" },
        },
        {
          id: "EVT-0901",
          timestamp: new Date(now + 100).toISOString(),
          relativeMs: 100,
          type: "rest-request",
          origin: "user",
          correlationId: "COR-0900",
          data: {
            method: "GET",
            url: "http://device/v1/info",
            normalizedUrl: "/v1/info",
            headers: {},
            body: null,
            target: "real-device",
          },
        },
        {
          id: "EVT-0902",
          timestamp: new Date(now + 150).toISOString(),
          relativeMs: 150,
          type: "rest-response",
          origin: "user",
          correlationId: "COR-0900",
          data: { status: 200, body: {}, durationMs: 50, error: null },
        },
        {
          id: "EVT-0903",
          timestamp: new Date(now + 200).toISOString(),
          relativeMs: 200,
          type: "ftp-operation",
          origin: "user",
          correlationId: "COR-0900",
          data: {
            operation: "list",
            path: "/SIDS",
            result: "failure",
            error: "Denied",
            target: "real-device",
          },
        },
        {
          id: "EVT-0904",
          timestamp: new Date(now + 210).toISOString(),
          relativeMs: 210,
          type: "error",
          origin: "user",
          correlationId: "COR-0900",
          data: { message: "FTP failed", name: "Error" },
        },
        {
          id: "EVT-0905",
          timestamp: new Date(now + 300).toISOString(),
          relativeMs: 300,
          type: "action-end",
          origin: "user",
          correlationId: "COR-0900",
          data: { status: "error", error: "FTP failed" },
        },
        {
          id: "EVT-0906",
          timestamp: new Date(now + 400).toISOString(),
          relativeMs: 400,
          type: "ftp-operation",
          origin: "user",
          correlationId: "COR-0900",
          data: {
            operation: "list",
            path: "/LATE",
            result: "failure",
            error: "late event",
            target: "real-device",
          },
        },
      ];
    })) as TraceEvent[];

    await waitForTracing(page);

    // Seed traces with await for event to propagate
    await page.evaluate((seedEvents: TraceEvent[]) => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          window.removeEventListener("c64u-traces-updated", handler);
          setTimeout(resolve, 50);
        };
        window.addEventListener("c64u-traces-updated", handler);
        const tracing = (
          window as Window & {
            __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void };
          }
        ).__c64uTracing;
        tracing?.seedTraces?.(seedEvents);
      });
    }, events);

    // Open the diagnostics dialog
    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Diagnostics" })).toBeVisible();
    await snap(page, testInfo, "diagnostics-open");

    // Actions evidence filter is active by default – verify before inspecting content
    await expect(page.getByTestId("evidence-toggle-actions")).toHaveAttribute("aria-pressed", "true");

    // Verify action summary is visible
    await expect(page.getByTestId("action-summary-COR-0900")).toBeVisible();

    // Verify badge counts
    await expect(page.getByTestId("action-rest-count-COR-0900")).toHaveText("REST×1");
    await expect(page.getByTestId("action-ftp-count-COR-0900")).toHaveText("FTP×1");
    await expect(page.getByTestId("action-error-count-COR-0900")).toHaveText("ERR×1");
    await snap(page, testInfo, "actions-tab");

    // Expand the action details
    await page.getByTestId("action-summary-COR-0900").locator("summary").click();
    await expect(page.getByTestId("action-rest-effect-COR-0900-0")).toBeVisible();
    await expect(page.getByTestId("action-ftp-effect-COR-0900-0")).toBeVisible();
    await expect(page.getByTestId("action-error-effect-COR-0900-0")).toBeVisible();
    await expect(page.getByTestId("action-rest-effect-COR-0900-1")).toHaveCount(0);
    await expect(page.getByTestId("action-ftp-effect-COR-0900-1")).toHaveCount(0);
    await expect(page.getByText("No REST effects.")).toHaveCount(0);
    await expect(page.getByText("No FTP effects.")).toHaveCount(0);
    await snap(page, testInfo, "actions-expanded");
  });

  test("renders target labels as demo and sandbox without mock wording", async ({
    page,
  }: { page: Page }, testInfo: TestInfo) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await snap(page, testInfo, "settings-open-target-labels");

    await page.evaluate(() => {
      const tracing = (
        window as Window & {
          __c64uTracing?: {
            resetTraceSession?: (eventIdStart?: number, correlationIdStart?: number) => void;
          };
        }
      ).__c64uTracing;
      tracing?.resetTraceSession?.(700, 700);
    });

    const events = (await page.evaluate(() => {
      const now = Date.now();
      return [
        {
          id: "EVT-0700",
          timestamp: new Date(now).toISOString(),
          relativeMs: 0,
          type: "action-start",
          origin: "user",
          correlationId: "COR-0700",
          data: { name: "internal.mock.action" },
        },
        {
          id: "EVT-0701",
          timestamp: new Date(now + 10).toISOString(),
          relativeMs: 10,
          type: "rest-request",
          origin: "user",
          correlationId: "COR-0700",
          data: {
            method: "GET",
            url: "http://demo/v1/info",
            normalizedUrl: "/v1/info",
            target: "internal-mock",
          },
        },
        {
          id: "EVT-0702",
          timestamp: new Date(now + 30).toISOString(),
          relativeMs: 30,
          type: "rest-response",
          origin: "user",
          correlationId: "COR-0700",
          data: { status: 200, body: {}, durationMs: 20, error: null },
        },
        {
          id: "EVT-0703",
          timestamp: new Date(now + 40).toISOString(),
          relativeMs: 40,
          type: "action-end",
          origin: "user",
          correlationId: "COR-0700",
          data: { status: "success", error: null },
        },
        {
          id: "EVT-0710",
          timestamp: new Date(now + 100).toISOString(),
          relativeMs: 100,
          type: "action-start",
          origin: "user",
          correlationId: "COR-0710",
          data: { name: "external.mock.action" },
        },
        {
          id: "EVT-0711",
          timestamp: new Date(now + 110).toISOString(),
          relativeMs: 110,
          type: "rest-request",
          origin: "user",
          correlationId: "COR-0710",
          data: {
            method: "GET",
            url: "http://sandbox/v1/info",
            normalizedUrl: "/v1/info",
            target: "external-mock",
          },
        },
        {
          id: "EVT-0712",
          timestamp: new Date(now + 130).toISOString(),
          relativeMs: 130,
          type: "rest-response",
          origin: "user",
          correlationId: "COR-0710",
          data: { status: 200, body: {}, durationMs: 20, error: null },
        },
        {
          id: "EVT-0713",
          timestamp: new Date(now + 140).toISOString(),
          relativeMs: 140,
          type: "action-end",
          origin: "user",
          correlationId: "COR-0710",
          data: { status: "success", error: null },
        },
        {
          id: "EVT-0720",
          timestamp: new Date(now + 200).toISOString(),
          relativeMs: 200,
          type: "action-start",
          origin: "user",
          correlationId: "COR-0720",
          data: { name: "unknown.product.action" },
        },
        {
          id: "EVT-0721",
          timestamp: new Date(now + 210).toISOString(),
          relativeMs: 210,
          type: "rest-request",
          origin: "user",
          correlationId: "COR-0720",
          data: {
            method: "GET",
            url: "http://device/v1/info",
            normalizedUrl: "/v1/info",
            target: "real-device",
          },
        },
        {
          id: "EVT-0722",
          timestamp: new Date(now + 230).toISOString(),
          relativeMs: 230,
          type: "rest-response",
          origin: "user",
          correlationId: "COR-0720",
          data: {
            status: 200,
            body: { product: "unknown-model" },
            durationMs: 20,
            error: null,
          },
        },
        {
          id: "EVT-0723",
          timestamp: new Date(now + 240).toISOString(),
          relativeMs: 240,
          type: "action-end",
          origin: "user",
          correlationId: "COR-0720",
          data: { status: "success", error: null },
        },
      ];
    })) as TraceEvent[];

    await waitForTracing(page);
    await page.evaluate((seedEvents: TraceEvent[]) => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          window.removeEventListener("c64u-traces-updated", handler);
          setTimeout(resolve, 50);
        };
        window.addEventListener("c64u-traces-updated", handler);
        const tracing = (
          window as Window & {
            __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void };
          }
        ).__c64uTracing;
        tracing?.seedTraces?.(seedEvents);
      });
    }, events);

    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Diagnostics" })).toBeVisible();
    // Actions evidence filter is active by default
    await expect(page.getByTestId("evidence-toggle-actions")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("action-summary-COR-0700").locator("summary").click();
    await page.getByTestId("action-summary-COR-0710").locator("summary").click();
    await page.getByTestId("action-summary-COR-0720").locator("summary").click();

    await expect(page.getByTestId("action-rest-effect-COR-0700-0")).toContainText("target: demo");
    await expect(page.getByTestId("action-rest-effect-COR-0710-0")).toContainText("target: sandbox");
    await expect(page.getByTestId("action-rest-effect-COR-0720-0")).toContainText("target: device");
    await expect(page.getByText(/target:\s*mock\b/i)).toHaveCount(0);
    await snap(page, testInfo, "actions-target-labels");
  });
});
