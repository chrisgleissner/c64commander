import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

test.describe('FTP performance', () => {
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  const ensureRemoteRoot = async (page: Page) => {
    const rootButton = page.locator('[data-testid="navigate-root"]');
    if (await rootButton.isVisible()) {
      if (await rootButton.isEnabled()) {
        await rootButton.click();
      }
    }
  };

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('FTP navigation uses cache across reloads', async ({ page }: { page: Page }, testInfo) => {
    const counts = new Map<string, number>();
    await page.route('**/v1/ftp/list', async (route) => {
      const body = route.request().postData();
      if (body) {
        const payload = JSON.parse(body) as { path?: string };
        const path = payload.path || '/';
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
      await route.continue();
    });

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
    await dialog.getByText('Usb0', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await expect(dialog.getByText('Games', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-opened');

    const firstCount = counts.get('/Usb0') ?? 0;
    expect(firstCount).toBeGreaterThan(0);

    await page.reload();
    await snap(page, testInfo, 'reloaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    const reloadDialog = page.getByRole('dialog');
    await expect(reloadDialog.getByText('Usb0', { exact: true })).toBeVisible();
    await reloadDialog.getByText('Usb0', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await expect(reloadDialog.getByText('Games', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'cache-hit');

    const secondCount = counts.get('/Usb0') ?? 0;
    expect(secondCount).toBe(firstCount);
  });

  test('FTP navigation shows minimal loading delay', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await expect(page.getByTestId('ftp-loading')).toBeHidden({ timeout: 800 });
    await snap(page, testInfo, 'loading-hidden');
  });
});
