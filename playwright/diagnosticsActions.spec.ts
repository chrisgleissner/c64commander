import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { saveCoverageFromPage } from './withCoverage';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
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

    await page.evaluate(() => {
      const tracing = (window as Window & { __c64uTracing?: { resetTraceSession?: (e?: number, c?: number) => void } }).__c64uTracing;
      tracing?.resetTraceSession?.(0, 0);
    });

    const events = [
      {
        id: 'EVT-0000',
        timestamp: '2024-01-01T00:00:00.000Z',
        relativeMs: 0,
        type: 'action-start',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { name: 'demo.action' },
      },
      {
        id: 'EVT-0001',
        timestamp: '2024-01-01T00:00:00.100Z',
        relativeMs: 100,
        type: 'rest-request',
        origin: 'user',
        correlationId: 'COR-0001',
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
        id: 'EVT-0002',
        timestamp: '2024-01-01T00:00:00.150Z',
        relativeMs: 150,
        type: 'rest-response',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { status: 200, body: {}, durationMs: 50, error: null },
      },
      {
        id: 'EVT-0003',
        timestamp: '2024-01-01T00:00:00.200Z',
        relativeMs: 200,
        type: 'ftp-operation',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { operation: 'list', path: '/SIDS', result: 'failure', error: 'Denied', target: 'real-device' },
      },
      {
        id: 'EVT-0004',
        timestamp: '2024-01-01T00:00:00.210Z',
        relativeMs: 210,
        type: 'error',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { message: 'FTP failed', name: 'Error' },
      },
      {
        id: 'EVT-0005',
        timestamp: '2024-01-01T00:00:00.300Z',
        relativeMs: 300,
        type: 'action-end',
        origin: 'user',
        correlationId: 'COR-0001',
        data: { status: 'error', error: 'FTP failed' },
      },
    ];

    await page.evaluate((seedEvents) => {
      const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (events: any[]) => void } }).__c64uTracing;
      tracing?.seedTraces?.(seedEvents as any[]);
    }, events);

    await page.getByRole('button', { name: 'Logs and Traces' }).click();
    await expect(page.getByRole('dialog', { name: 'Diagnostics' })).toBeVisible();
    await snap(page, testInfo, 'diagnostics-open');

    await page.getByRole('tab', { name: 'Actions' }).click();
    await expect(page.getByTestId('action-summary-COR-0001')).toBeVisible();

    await expect(page.getByTestId('action-rest-count-COR-0001')).toHaveText('1');
    await expect(page.getByTestId('action-ftp-count-COR-0001')).toHaveText('1');
    await expect(page.getByTestId('action-error-count-COR-0001')).toHaveText('1');
    await snap(page, testInfo, 'actions-tab');

    await page.getByTestId('action-summary-COR-0001').locator('summary').click();
    await expect(page.getByTestId('action-rest-effect-COR-0001-0')).toBeVisible();
    await expect(page.getByTestId('action-ftp-effect-COR-0001-0')).toBeVisible();
    await snap(page, testInfo, 'actions-expanded');
  });
});
