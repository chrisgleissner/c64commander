/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import type { TraceEvent } from '../src/lib/tracing/types';
import { seedUiMocks } from './uiMocks';
import { saveCoverageFromPage } from './withCoverage';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const waitForTracing = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces));
};

test.describe('Diagnostics Actions tab', () => {
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

  test('shows action summaries with badges and details', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'settings-open');

    // Reset trace session - start counters high enough that natural events don't reach seeded IDs
    // Natural events from navigation will use EVT-0500+, our seeded events use EVT-0900+
    await page.evaluate(() => {
      const tracing = (window as Window & {
        __c64uTracing?: { resetTraceSession?: (eventIdStart?: number, correlationIdStart?: number) => void };
      }).__c64uTracing;
      tracing?.resetTraceSession?.(500, 500);
    });

    // Build events with CURRENT timestamps (within retention window)
    // Using EVT-0900+ to avoid any conflict with natural emissions starting at EVT-0500
    const events = (await page.evaluate(() => {
      const now = Date.now();
      return [
        {
          id: 'EVT-0900',
          timestamp: new Date(now).toISOString(),
          relativeMs: 0,
          type: 'action-start',
          origin: 'user',
          correlationId: 'COR-0900',
          data: { name: 'demo.action' },
        },
        {
          id: 'EVT-0901',
          timestamp: new Date(now + 100).toISOString(),
          relativeMs: 100,
          type: 'rest-request',
          origin: 'user',
          correlationId: 'COR-0900',
          data: {
            method: 'GET',
            url: 'http://device/v1/info',
            normalizedUrl: '/v1/info',
            headers: {},
            body: null,
            target: 'real-device',
          },
        },
        {
          id: 'EVT-0902',
          timestamp: new Date(now + 150).toISOString(),
          relativeMs: 150,
          type: 'rest-response',
          origin: 'user',
          correlationId: 'COR-0900',
          data: { status: 200, body: {}, durationMs: 50, error: null },
        },
        {
          id: 'EVT-0903',
          timestamp: new Date(now + 200).toISOString(),
          relativeMs: 200,
          type: 'ftp-operation',
          origin: 'user',
          correlationId: 'COR-0900',
          data: { operation: 'list', path: '/SIDS', result: 'failure', error: 'Denied', target: 'real-device' },
        },
        {
          id: 'EVT-0904',
          timestamp: new Date(now + 210).toISOString(),
          relativeMs: 210,
          type: 'error',
          origin: 'user',
          correlationId: 'COR-0900',
          data: { message: 'FTP failed', name: 'Error' },
        },
        {
          id: 'EVT-0905',
          timestamp: new Date(now + 300).toISOString(),
          relativeMs: 300,
          type: 'action-end',
          origin: 'user',
          correlationId: 'COR-0900',
          data: { status: 'error', error: 'FTP failed' },
        },
      ];
    })) as TraceEvent[];

    await waitForTracing(page);

    // Seed traces with await for event to propagate
    await page.evaluate((seedEvents: TraceEvent[]) => {
      return new Promise<void>((resolve) => {
        const handler = () => {
          window.removeEventListener('c64u-traces-updated', handler);
          setTimeout(resolve, 50);
        };
        window.addEventListener('c64u-traces-updated', handler);
        const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void } }).__c64uTracing;
        tracing?.seedTraces?.(seedEvents);
      });
    }, events);

    // Open the diagnostics dialog
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Diagnostics' })).toBeVisible();
    await snap(page, testInfo, 'diagnostics-open');

    // Navigate to Actions tab
    await page.getByRole('tab', { name: 'Actions' }).click();

    // Wait for the actions tab to render and verify action summary is visible
    await expect(page.getByTestId('action-summary-COR-0900')).toBeVisible();

    // Verify badge counts
    await expect(page.getByTestId('action-rest-count-COR-0900')).toHaveText('REST×1');
    await expect(page.getByTestId('action-ftp-count-COR-0900')).toHaveText('FTP×1');
    await expect(page.getByTestId('action-error-count-COR-0900')).toHaveText('ERR×1');
    await snap(page, testInfo, 'actions-tab');

    // Expand the action details
    await page.getByTestId('action-summary-COR-0900').locator('summary').click();
    await expect(page.getByTestId('action-rest-effect-COR-0900-0')).toBeVisible();
    await expect(page.getByTestId('action-ftp-effect-COR-0900-0')).toBeVisible();
    await snap(page, testInfo, 'actions-expanded');
  });
});
