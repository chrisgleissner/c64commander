import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { enableTraceAssertions } from './traceUtils';
import { clickSourceSelectionButton } from './sourceSelection';

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

  const openRemoteFolder = async (container: Page | Locator, name: string) => {
    await container.locator('[data-testid="source-entry-row"]', { hasText: name }).first().click();
  };

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
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

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('FTP navigation uses cache across reloads', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await ensureRemoteRoot(page);
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
    await dialog.locator('[data-testid="source-entry-row"]', { hasText: 'Usb0' }).first().click();
    await expect(dialog.getByText('Games', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-opened');

    const firstCount = counts.get('/Usb0') ?? 0;
    expect(firstCount).toBeGreaterThan(0);

    await page.reload();
    await snap(page, testInfo, 'reloaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const reloadDialog = page.getByRole('dialog');
    await clickSourceSelectionButton(reloadDialog, 'C64 Ultimate');
    await ensureRemoteRoot(page);
    await expect(reloadDialog.getByText('Usb0', { exact: true })).toBeVisible();
    await reloadDialog.locator('[data-testid="source-entry-row"]', { hasText: 'Usb0' }).first().click();
    await expect(reloadDialog.getByText('Games', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'cache-hit');

    const secondCount = counts.get('/Usb0') ?? 0;
    expect(secondCount).toBe(firstCount);
  });

  test('FTP navigation shows minimal loading delay', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await expect(page.getByTestId('ftp-loading')).toBeHidden({ timeout: 1500 });
    await snap(page, testInfo, 'loading-hidden');
  });

  test('FTP navigation shows delayed loading indicator on slow requests', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.route('**/v1/ftp/list', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });

    await page.addInitScript(() => {
      localStorage.removeItem('c64u_ftp_cache:v1');
    });

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');

    await expect(page.getByTestId('ftp-loading')).toBeVisible({ timeout: 1200 });
    await snap(page, testInfo, 'loading-visible');

    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await expect(page.getByTestId('ftp-loading')).toBeHidden({ timeout: 1500 });
    await snap(page, testInfo, 'loading-hidden-after');
  });

  test('adding large FTP folder avoids ftp.read and completes quickly', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    let readCount = 0;
    await page.route('**/v1/ftp/read', async (route) => {
      readCount += 1;
      await route.continue();
    });

    await page.goto('/play');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await ensureRemoteRoot(page);
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');

    const megaCollectionRow = dialog.locator('[data-testid="source-entry-row"]', { hasText: 'Mega Collection' }).first();
    await megaCollectionRow.getByRole('checkbox').click();
    await snap(page, testInfo, 'mega-collection-selected');

    const startedAt = Date.now();
    await page.getByTestId('add-items-confirm').click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    const elapsedMs = Date.now() - startedAt;

    await expect(page.getByTestId('playlist-list')).toContainText('Mega Disk 01.d64');
    expect(readCount).toBe(0);
    expect(elapsedMs).toBeLessThan(7000);
    await snap(page, testInfo, 'mega-collection-imported');
  });
});
