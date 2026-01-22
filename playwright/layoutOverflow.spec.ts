import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      docOverflow: doc.scrollWidth - doc.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
    };
  });
  expect(overflow.docOverflow, 'Document width overflow detected').toBeLessThanOrEqual(1);
  expect(overflow.bodyOverflow, 'Body width overflow detected').toBeLessThanOrEqual(1);
};

const seedDiskLibrary = async (page: Page, disks: Array<{ id: string; name: string; path: string; location: 'local' | 'ultimate'; group?: string | null; importOrder?: number | null }>) => {
  await page.addInitScript(({ disks: seedDisks }) => {
    const payload = {
      disks: seedDisks.map((disk) => ({
        ...disk,
        group: disk.group ?? null,
        importedAt: new Date().toISOString(),
        sizeBytes: 1234,
        modifiedAt: new Date().toISOString(),
      })),
    };
    localStorage.setItem('c64u_disk_library:TEST-123', JSON.stringify(payload));
  }, { disks });
};

test.describe('Layout overflow safeguards', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.setViewportSize({ width: 360, height: 740 });
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

  test('disks page handles long names without overflow', async ({ page }, testInfo) => {
    await seedDiskLibrary(page, [
      {
        id: 'local:/Extremely/Long/Path/With/Deep/Structure/And-A-Super-Long-Disk-Name-That-Should-Not-Overflow-Device-Width.d64',
        name: 'Super-Long-Disk-Name-That-Should-Not-Overflow-Device-Width.d64',
        path: '/Extremely/Long/Path/With/Deep/Structure/And-A-Super-Long-Disk-Name-That-Should-Not-Overflow-Device-Width.d64',
        location: 'local',
        group: 'Group-With-An-Extra-Long-Name-For-Overflow-Testing',
        importOrder: 1,
      },
      {
        id: 'ultimate:/Usb0/Long-Names-For-Overflow-Testing/Another-Very-Long-Disk-Name-That-Should-Not-Overflow.d64',
        name: 'Another-Very-Long-Disk-Name-That-Should-Not-Overflow.d64',
        path: '/Usb0/Long-Names-For-Overflow-Testing/Another-Very-Long-Disk-Name-That-Should-Not-Overflow.d64',
        location: 'ultimate',
        group: null,
        importOrder: 2,
      },
    ]);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-long-names');
    await expectNoHorizontalOverflow(page);

    const viewAll = page.getByRole('button', { name: 'View all' }).first();
    if (await viewAll.isVisible()) {
      await viewAll.click();
      await snap(page, testInfo, 'disks-view-all');
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }
  });

  test('playlist list handles long names without overflow', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const payload = {
        items: [
          {
            source: 'ultimate',
            path: '/Usb0/Long/Path/With/An-Extremely-Long-File-Name-That-Should-Not-Overflow-When-Rendered.sid',
            name: 'An-Extremely-Long-File-Name-That-Should-Not-Overflow-When-Rendered.sid',
            durationMs: 60000,
            songNr: 1,
            sourceId: null,
          },
        ],
        currentIndex: 0,
      };
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
    });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'playlist-long-names');
    await expectNoHorizontalOverflow(page);

    const viewAll = page.getByRole('button', { name: 'View all' }).first();
    if (await viewAll.isVisible()) {
      await viewAll.click();
      await snap(page, testInfo, 'playlist-view-all');
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }
  });

  test('FTP browser handles long names without overflow', async ({ page }, testInfo) => {
    const ftpServers = await startFtpTestServers();
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await dialog.getByText('Usb0', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await dialog.getByText('Long-Names-For-Overflow-Testing', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await snap(page, testInfo, 'ftp-long-names');
    await expectNoHorizontalOverflow(page);

    await ftpServers.close();
  });

  test('diagnostics dialog stays within viewport', async ({ page }, testInfo) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'settings-open');

    await page.getByRole('button', { name: 'Logs' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'diagnostics-dialog');
    await expectNoHorizontalOverflow(page);

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (dialogBox && viewport) {
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
    }
  });
});
