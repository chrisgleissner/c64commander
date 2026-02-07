import { test, expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { disableTraceAssertions } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';
import { saveCoverageFromPage } from './withCoverage';
import { clickSourceSelectionButton } from './sourceSelection';
import { layoutTest, enforceDeviceTestMapping } from './layoutTest';

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

const expectDialogWithinViewport = async (page: Page, dialog: Locator) => {
  await expect(dialog).toBeVisible();
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
};

const expectVerticalOverflowHandled = async (container: Locator) => {
  const metrics = await container.evaluate((el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: style.overflowY,
    };
  });

  if (metrics.scrollHeight > metrics.clientHeight) {
    expect(metrics.overflowY).not.toBe('visible');
  }
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

const seedPlaylistStorage = async (page: Page, items: Array<{ source: 'ultimate' | 'local'; path: string; name: string; durationMs?: number }>) => {
  await page.addInitScript(({ seedItems }) => {
    const payload = {
      items: seedItems,
      currentIndex: -1,
    };
    localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
  }, { seedItems: items });
};

test.describe('Layout overflow safeguards', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, 'Layout-only coverage; trace assertions disabled.');
    enforceDeviceTestMapping(testInfo);
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

  layoutTest('disks page handles long names without overflow @layout', async ({ page }, testInfo) => {
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
      const dialog = page.getByRole('dialog');
      await expectDialogWithinViewport(page, dialog);
      await snap(page, testInfo, 'disks-view-all');
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }
  });

  layoutTest('playlist list handles long names without overflow @layout', async ({ page }, testInfo) => {
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
      const dialog = page.getByRole('dialog');
      await expectDialogWithinViewport(page, dialog);
      await snap(page, testInfo, 'playlist-view-all');
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }
  });

  layoutTest('playlist filter header does not cause overflow @layout', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    await seedPlaylistStorage(page, Array.from({ length: 60 }, (_, index) => ({
      source: 'ultimate' as const,
      path: `/Usb0/Demos/Track_${String(index + 1).padStart(3, '0')}.sid`,
      name: `Track_${String(index + 1).padStart(3, '0')}.sid`,
      durationMs: 5000,
    })));

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, dialog);

    const filter = page.getByTestId('view-all-filter-input');
    await filter.fill('Track_0');
    await snap(page, testInfo, 'view-all-filter');
    await expectNoHorizontalOverflow(page);
  });

  layoutTest('FTP browser handles long names without overflow @layout', async ({ page }, testInfo) => {
    const ftpServers = await startFtpTestServers();
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await clickSourceSelectionButton(page.getByRole('dialog'), 'C64 Ultimate');

    const dialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, dialog);
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await dialog.locator('[data-testid="source-entry-row"]', { hasText: 'Usb0' }).first().click();
    await dialog.locator('[data-testid="source-entry-row"]', { hasText: 'Long-Names-For-Overflow-Testing' }).first().click();
    await dialog
      .locator('[data-testid="source-entry-row"]', { hasText: 'Super-Long-Folder-Name-That-Is-Definitely-Too-Wide-For-Mobile-Viewports-And-Should-Wrap' })
      .first()
      .click();
    await snap(page, testInfo, 'ftp-long-names');
    await expectNoHorizontalOverflow(page);
    await expectDialogWithinViewport(page, dialog);

    await ftpServers.close();
  });

  layoutTest('diagnostics dialog stays within viewport @layout', async ({ page }, testInfo) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'settings-open');
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
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

  layoutTest('settings page handles long hostnames without overflow @layout', async ({ page }, testInfo) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const hostInput = page.getByLabel('C64U Hostname / IP');
    await hostInput.fill('super-long-hostname-with-many-subdomains-and-segments-that-should-wrap-without-overflow.example.c64u.local');
    const passwordInput = page.getByLabel('Network Password');
    await passwordInput.fill('ultra-long-password-value-that-should-not-force-horizontal-scrolling-on-small-devices');
    await snap(page, testInfo, 'settings-long-hostname');
    await expectNoHorizontalOverflow(page);
  });

  layoutTest('settings logs handle long error messages without overflow @layout', async ({ page }, testInfo) => {
    enableGoldenTrace(testInfo);
    await page.addInitScript(() => {
      const payload = [
        {
          id: 'long-error-1',
          level: 'error',
          message: 'Extremely-long-error-message-with-a-very-long-url-https://example.c64u.local/some/really/long/path/that/should-not-overflow',
          timestamp: new Date().toISOString(),
          details: {
            requestUrl: 'https://example.c64u.local/some/really/long/path/that/should-not-overflow?with=query&and=parameters',
          },
        },
      ];
      localStorage.setItem('c64u_app_logs', JSON.stringify(payload));
    });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'settings-long-log');
    await expectNoHorizontalOverflow(page);
  });

  layoutTest('play dialogs stay within viewport @layout', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const payload = {
        items: [
          {
            source: 'ultimate',
            path: '/Usb0/Demos/demo.sid',
            name: 'demo.sid',
            durationMs: 60000,
            songNr: 1,
            sourceId: null,
          },
          {
            source: 'ultimate',
            path: '/Usb0/Demos/demo2.sid',
            name: 'demo2.sid',
            durationMs: 60000,
            songNr: 1,
            sourceId: null,
          },
        ],
        currentIndex: 0,
      };
      localStorage.setItem('c64u_list_preview_limit', '1');
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
    });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const addDialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, addDialog);
    await snap(page, testInfo, 'add-items-dialog');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'View all' }).click();
    const playlistDialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, playlistDialog);
    await snap(page, testInfo, 'playlist-dialog');
    await page.keyboard.press('Escape');

    await expectNoHorizontalOverflow(page);
  });


  layoutTest('primary pages avoid horizontal overflow @layout', async ({ page }, testInfo) => {
    const pages = [
      { path: '/', label: 'home' },
      { path: '/play', label: 'play' },
      { path: '/disks', label: 'disks' },
      { path: '/config', label: 'config' },
      { path: '/settings', label: 'settings' },
      { path: '/docs', label: 'docs' },
    ];

    for (const entry of pages) {
      await page.goto(entry.path, { waitUntil: 'domcontentloaded' });
      await snap(page, testInfo, `page-${entry.label}`);
      await expectNoHorizontalOverflow(page);
    }
  });

  layoutTest('disk dialogs stay within viewport @layout', async ({ page }, testInfo) => {
    await seedDiskLibrary(page, [
      {
        id: 'local:/Extremely/Long/Path/With/Deep/Structure/And-A-Super-Long-Disk-Name-That-Should-Not-Overflow-Device-Width.d64',
        name: 'Super-Long-Disk-Name-That-Should-Not-Overflow-Device-Width.d64',
        path: '/Extremely/Long/Path/With/Deep/Structure/And-A-Super-Long-Disk-Name-That-Should-Not-Overflow-Device-Width.d64',
        location: 'local',
        group: 'Group-With-An-Extra-Long-Name-For-Overflow-Testing',
        importOrder: 1,
      },
    ]);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
    const addDialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, addDialog);
    await snap(page, testInfo, 'disks-add-items-dialog');
    await page.keyboard.press('Escape');

    const row = page.getByTestId('disk-row').first();
    await row.getByRole('button', { name: 'Item actions' }).click();
    await page.getByRole('menuitem', { name: 'Set group…' }).click();
    const groupDialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, groupDialog);
    await snap(page, testInfo, 'disk-group-dialog');
    await page.keyboard.press('Escape');

    await row.getByRole('button', { name: 'Item actions' }).click();
    await page.getByRole('menuitem', { name: 'Rename disk…' }).click();
    const renameDialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, renameDialog);
    await snap(page, testInfo, 'disk-rename-dialog');
    await page.keyboard.press('Escape');

    await row.getByRole('button', { name: 'Item actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove from collection' }).click();
    const deleteDialog = page.getByRole('dialog');
    await expectDialogWithinViewport(page, deleteDialog);
    await snap(page, testInfo, 'disk-delete-dialog');
    await page.keyboard.press('Escape');

    await expectNoHorizontalOverflow(page);
  });

  layoutTest('viewport matrix preserves layout and scrolling @layout', async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);
    const viewports = [
      { width: 360, height: 640, label: 'phone-small' },
      { width: 428, height: 926, label: 'phone-large' },
      { width: 800, height: 1280, label: 'tablet-portrait' },
      { width: 844, height: 390, label: 'phone-landscape' },
    ];

    const seededDisks = [
      {
        id: 'local:/Usb0/Overflow/Long-Disk-Name-For-Layout-Matrix-1.d64',
        name: 'Long-Disk-Name-For-Layout-Matrix-1.d64',
        path: '/Usb0/Overflow/Long-Disk-Name-For-Layout-Matrix-1.d64',
        location: 'local' as const,
        group: 'Layout-Matrix-Group',
        importOrder: 1,
      },
      {
        id: 'ultimate:/Usb0/Overflow/Long-Disk-Name-For-Layout-Matrix-2.d64',
        name: 'Long-Disk-Name-For-Layout-Matrix-2.d64',
        path: '/Usb0/Overflow/Long-Disk-Name-For-Layout-Matrix-2.d64',
        location: 'ultimate' as const,
        group: 'Layout-Matrix-Group',
        importOrder: 2,
      },
    ];

    const seededPlaylist = [
      {
        source: 'ultimate' as const,
        path: '/Usb0/Demos/Layout-Matrix-Long-Track-Name-That-Should-Not-Overflow.sid',
        name: 'Layout-Matrix-Long-Track-Name-That-Should-Not-Overflow.sid',
        durationMs: 60000,
      },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedDiskLibrary(page, seededDisks);
      await seedPlaylistStorage(page, seededPlaylist);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await snap(page, testInfo, `matrix-home-${viewport.label}`);
      await expectNoHorizontalOverflow(page);

      await page.goto('/play', { waitUntil: 'domcontentloaded' });
      await snap(page, testInfo, `matrix-play-${viewport.label}`);
      await expectNoHorizontalOverflow(page);

      await page.getByRole('button', { name: /Add items|Add more items/i }).click();
      const addDialog = page.getByRole('dialog');
      await expectDialogWithinViewport(page, addDialog);
      await expectVerticalOverflowHandled(addDialog);
      await snap(page, testInfo, `matrix-add-items-${viewport.label}`);
      const scrollArea = addDialog.locator('[data-virtuoso-scroller="true"]');
      if (await scrollArea.count()) {
        const scrollable = await scrollArea.evaluate((node: HTMLElement) => node.scrollHeight > node.clientHeight);
        expect(scrollable).toBeTruthy();
      }
      await page.keyboard.press('Escape');

      const viewAll = page.getByRole('button', { name: 'View all' }).first();
      if (await viewAll.isVisible({ timeout: 2000 }).catch(() => false)) {
        await viewAll.click();
        const viewAllDialog = page.getByRole('dialog');
        await expectDialogWithinViewport(page, viewAllDialog);
        await expectVerticalOverflowHandled(viewAllDialog);
        await snap(page, testInfo, `matrix-play-view-all-${viewport.label}`);
        await page.keyboard.press('Escape');
      }

      await page.goto('/disks', { waitUntil: 'domcontentloaded' });
      await snap(page, testInfo, `matrix-disks-${viewport.label}`);
      await expectNoHorizontalOverflow(page);

      const diskAddItems = page.getByRole('button', { name: /Add disks|Add more disks/i });
      if (await diskAddItems.isVisible({ timeout: 2000 }).catch(() => false)) {
        await diskAddItems.click();
        const diskDialog = page.getByRole('dialog');
        await expectDialogWithinViewport(page, diskDialog);
        await expectVerticalOverflowHandled(diskDialog);
        await snap(page, testInfo, `matrix-disks-add-items-${viewport.label}`);
        await page.keyboard.press('Escape');
      }

      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await snap(page, testInfo, `matrix-settings-${viewport.label}`);
      await expectNoHorizontalOverflow(page);

      const logsButton = page.getByRole('button', { name: /Logs( and Traces)?/i });
      if (await logsButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await logsButton.click();
        const logsDialog = page.getByRole('dialog');
        await expectDialogWithinViewport(page, logsDialog);
        await expectVerticalOverflowHandled(logsDialog);
        await snap(page, testInfo, `matrix-logs-${viewport.label}`);
        await page.keyboard.press('Escape');
      }

      await page.goto('/config', { waitUntil: 'domcontentloaded' });
      await snap(page, testInfo, `matrix-config-${viewport.label}`);
      await expectNoHorizontalOverflow(page);
    }
  });

  test('AppBar header has safe-area top padding on all pages @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const routes = ['/', '/play', '/disks', '/config', '/settings'];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const header = page.locator('header').first();
      await expect(header).toBeVisible();
      const hasSafeClass = await header.evaluate((el: HTMLElement) => el.classList.contains('pt-safe'));
      expect(hasSafeClass, `header on ${route} should have pt-safe class`).toBe(true);
      await snap(page, testInfo, `safe-area-${route.replace('/', 'root').replace(/\//g, '-')}`);
    }
  });
});
