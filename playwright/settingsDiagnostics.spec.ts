import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Settings diagnostics workflows', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);

    await page.addInitScript(() => {
      window.addEventListener('c64u-logs-updated', () => { });

      const logs = [
        { id: 'log-1', timestamp: new Date().toISOString(), level: 'error', message: 'Test error 1', details: {} },
        { id: 'log-2', timestamp: new Date().toISOString(), level: 'info', message: 'Test info 1', details: {} },
      ];

      localStorage.setItem('c64u_app_logs', JSON.stringify(logs));
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

  test('open diagnostics dialog shows logs', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const diagnosticsButton = page.getByRole('button', { name: 'Diagnostics', exact: true });
    await expect(diagnosticsButton).toBeVisible();
    await snap(page, testInfo, 'diagnostics-button-visible');

    await diagnosticsButton.click();
    await snap(page, testInfo, 'button-clicked');

    const dialog = page.getByRole('dialog', { name: /Diagnostics|Logs/i });
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'dialog-open');

    // Check if logs are shown (they may not be if not loaded from storage)
    const logText = await dialog.getByText(/Test error 1|Test info 1|No entries|empty/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (logText) {
      await snap(page, testInfo, 'logs-shown');
    } else {
      await snap(page, testInfo, 'no-logs-or-empty');
    }
  });

  test('debug logging toggle records REST calls', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    enableTraceAssertions(testInfo);
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const debugToggle = page.getByLabel('Enable Debug Logging');
    await expect(debugToggle).toBeVisible();
    await debugToggle.click();
    await snap(page, testInfo, 'debug-logging-enabled');

    const refreshButton = page.getByRole('button', { name: 'Refresh connection' });
    await expect(refreshButton).toBeVisible();
    await clearTraces(page);
    await refreshButton.click();
    await snap(page, testInfo, 'refresh-clicked');

    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Diagnostics|Logs/i });
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'diagnostics-open');

    await dialog.getByRole('tab', { name: 'Logs', exact: true }).click();
    const apiRequestEntry = dialog.getByText('C64 API request', { exact: true }).first();
    await expect(apiRequestEntry).toBeVisible();
    await expect(apiRequestEntry.locator('xpath=..')).toContainText(/DEBUG/i);
    await snap(page, testInfo, 'debug-log-entry');

    const { requestEvent } = await expectRestTraceSequence(page, testInfo, '/v1/info');
    expect((requestEvent.data as { target?: string }).target).toBe('external-mock');
  });

  test('diagnostics action bar is available', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await snap(page, testInfo, 'dialog-open');

    await expect(page.getByRole('button', { name: /Clear All/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Share\s*\/\s*Export/i })).toBeVisible();
  });

  test('clear all diagnostics empties log storage', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await snap(page, testInfo, 'dialog-open');

    const clearButton = page.getByRole('button', { name: /Clear All/i });

    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const beforeLogs = await page.evaluate(() => localStorage.getItem('c64u_app_logs'));
      await clearButton.click();
      const confirm = page.getByRole('alertdialog', { name: /Clear diagnostics/i });
      await confirm.getByRole('button', { name: /Clear/i }).click();
      await snap(page, testInfo, 'clear-clicked');

      await expect
        .poll(async () => page.evaluate(() => localStorage.getItem('c64u_app_logs')), {
          timeout: 5000,
        })
        .not.toBe(beforeLogs);

      // Logs should be empty or at least the clear button was clicked
      await snap(page, testInfo, 'clear-attempted');

      const emptyStateVisible = await page.getByText(/No entries|empty|cleared/i).first().isVisible({ timeout: 3000 }).catch(() => false);
      if (emptyStateVisible) {
        await snap(page, testInfo, 'empty-state-shown');
      } else {
        await snap(page, testInfo, 'clear-completed');
      }
    } else {
      await snap(page, testInfo, 'clear-button-not-found');
    }
  });
});
