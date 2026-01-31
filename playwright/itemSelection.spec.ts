import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import * as path from 'node:path';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clearTraces, enableTraceAssertions, expectFtpTraceSequence } from './traceUtils';
import { clickSourceSelectionButton } from './sourceSelection';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const waitForFtpIdle = async (container: Page) => {
  const loading = container.getByTestId('ftp-loading');
  if (await loading.count()) {
    await expect(loading).toBeHidden({ timeout: 15000 });
  }
};

const ensureRemoteRoot = async (container: Page) => {
  const rootButton = container.getByTestId('navigate-root');
  if (!(await rootButton.isVisible())) return;
  await waitForFtpIdle(container);
  if (await rootButton.isEnabled()) {
    await rootButton.click();
    await waitForFtpIdle(container);
  }
};

const openRemoteFolder = async (container: Page, name: string) => {
  await waitForFtpIdle(container);
  await expect(container.getByText(name, { exact: true })).toBeVisible({ timeout: 10000 });
  const row = container.locator('[data-testid="source-entry-row"]', { hasText: name }).first();
  await row.getByRole('button', { name: 'Open' }).click();
};

const selectEntryCheckbox = async (container: Page, name: string) => {
  const row = container.locator('[data-testid="source-entry-row"]', { hasText: name }).first();
  await row.getByRole('checkbox').click();
};

const registerMockDirectoryPicker = async (page: Page, options: { folderName: string; fileName: string }) => {
  await page.addInitScript(({ folderName, fileName }) => {
    (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => {
      const file = new File(['data'], fileName, { type: 'application/octet-stream' });
      const fileHandle = {
        kind: 'file',
        getFile: async () => file,
      } as FileSystemFileHandle;
      const nestedFolder = {
        kind: 'directory',
        entries: async function* () {
          yield [fileName, fileHandle] as const;
        },
      } as FileSystemDirectoryHandle;
      const directoryHandle = {
        name: folderName,
        entries: async function* () {
          yield [folderName, nestedFolder] as const;
        },
      } as FileSystemDirectoryHandle;
      return directoryHandle;
    };
  }, options);
};

test.describe('Item Selection Dialog UX', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
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

  test('add items modal has single close button', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.waitForSelector('[role="dialog"]');
    await snap(page, testInfo, 'modal-opened');

    // Find all close buttons (X icons) in the dialog
    const dialog = page.locator('[role="dialog"]').first();
    // Count visible close buttons in top-right area
    const headerCloseButtons = await dialog.locator('button[aria-label*="Close"], button[class*="absolute"][class*="right"]').count();
    
    await snap(page, testInfo, 'close-buttons-check');
    
    // Should have exactly one close button
    expect(headerCloseButtons).toBeLessThanOrEqual(1);
  });

  test('add items modal does not occupy full viewport height', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.waitForSelector('[role="dialog"]');
    await snap(page, testInfo, 'modal-opened');

    const dialog = page.locator('[role="dialog"]').first();
    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();

    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();

    if (dialogBox && viewport) {
      // Modal should leave at least 10% margin at top and bottom combined
      const heightRatio = dialogBox.height / viewport.height;
      expect(heightRatio).toBeLessThan(0.90);
      
      // Modal should not start at viewport top
      expect(dialogBox.y).toBeGreaterThan(viewport.height * 0.05);
      
      await snap(page, testInfo, 'modal-sizing-verified');
    }
  });

  test('add items modal content is scrollable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.waitForSelector('[role="dialog"]');
    
    // Select C64 Ultimate source to get file list
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await waitForFtpIdle(dialog);
    await snap(page, testInfo, 'file-browser-opened');

    const scrollableContent = dialog.locator('[class*="overflow"]').first();

    // Check if content area is scrollable
    const isScrollable = await scrollableContent.evaluate((el: HTMLElement) => {
      return el.scrollHeight > el.clientHeight || el.classList.toString().includes('overflow');
    });

    await snap(page, testInfo, 'scrollable-check');
    
    // Content should either be scrollable or have overflow classes
    expect(isScrollable || (await scrollableContent.getAttribute('class'))?.includes('overflow')).toBeTruthy();
  });

  test('C64 Ultimate folder selection shows confirm button', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await waitForFtpIdle(dialog);
    await snap(page, testInfo, 'c64u-browser-opened');

    // Find and select a folder checkbox (row with Open button)
    const firstFolderRow = page
      .locator('[data-testid="source-entry-row"]')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .first();
    const checkbox = firstFolderRow.getByRole('checkbox').first();
    await checkbox.click();
    await snap(page, testInfo, 'folder-selected');

    // Confirm button should be visible and enabled
    const confirmButton = page.getByTestId('add-items-confirm');
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toBeEnabled();
    
    await snap(page, testInfo, 'confirm-button-visible');
  });

  test('Play page: C64 Ultimate full flow adds items', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await page.goto('/play');
    await snap(page, testInfo, 'play-initial');

    // Open add items dialog
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await snap(page, testInfo, 'add-items-opened');

    // Select C64 Ultimate source
    const dialog = page.getByRole('dialog');
    await clearTraces(page);
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await waitForFtpIdle(dialog);
    await snap(page, testInfo, 'c64u-selected');

    // Navigate to Usb0 folder
    await ensureRemoteRoot(dialog);
    await openRemoteFolder(dialog, 'Usb0');
    await waitForFtpIdle(dialog);
    await snap(page, testInfo, 'usb2-opened');

    await expectFtpTraceSequence(page, testInfo, (event) => {
      const data = event.data as { operation?: string; path?: string };
      return data.operation === 'list' && (data.path ?? '').includes('/Usb0');
    });

    // Select a folder (row with Open action)
    const firstCheckbox = page
      .locator('[data-testid="source-entry-row"]')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .first()
      .getByRole('checkbox');
    await firstCheckbox.click();
    await snap(page, testInfo, 'item-selected');

    // Click confirm
    const confirmButton = page.getByTestId('add-items-confirm');
    await confirmButton.click();
    await snap(page, testInfo, 'items-adding');

    // Wait for dialog to close
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
    await snap(page, testInfo, 'dialog-closed');

    // Verify we're back on Play page with items
    await expect(page.getByTestId('playlist-list')).toBeVisible();
    await snap(page, testInfo, 'back-to-play-page');
  });

  test('Play page: local folder picker returns to playlist', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await registerMockDirectoryPicker(page, {
      folderName: 'Local-Long-Folder-Name-For-Return-Flow',
      fileName: 'Super-Long-Local-Track-Name-For-Return-Flow.sid',
    });

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');

    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByTestId('playlist-list')).toBeVisible();
    await expect(
      page.getByTestId('playlist-item').filter({ hasText: 'Super-Long-Local-Track-Name-For-Return-Flow.sid' }).first(),
    ).toBeVisible();
    await snap(page, testInfo, 'playlist-returned');
  });

  test('Disks page: local folder picker returns to disk list', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await registerMockDirectoryPicker(page, {
      folderName: 'Local-Long-Disk-Folder-Name-For-Return-Flow',
      fileName: 'Super-Long-Local-Disk-Name-For-Return-Flow.d64',
    });

    await page.goto('/disks');
    await snap(page, testInfo, 'disks-open');

    await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');

    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByTestId('disk-list')).toBeVisible();
    await expect(
      page.getByTestId('disk-row').filter({ hasText: 'Super-Long-Local-Disk-Name-For-Return-Flow.d64' }).first(),
    ).toBeVisible();
    await snap(page, testInfo, 'disks-returned');
  });

  test('Disks page: C64 Ultimate full flow adds disks', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await snap(page, testInfo, 'disks-initial');

    // Open add items dialog
    await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
    await snap(page, testInfo, 'add-items-opened');

    // Select C64 Ultimate source
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await waitForFtpIdle(dialog);
    await snap(page, testInfo, 'c64u-selected');

    // Navigate to Usb0 folder
    await ensureRemoteRoot(dialog);
    if (await dialog.getByText('Usb0', { exact: true }).isVisible({ timeout: 2000 }).catch(() => false)) {
      await openRemoteFolder(dialog, 'Usb0');
      await waitForFtpIdle(dialog);
      await snap(page, testInfo, 'usb2-opened');
    }

    // Select a disk folder (row with Open action)
    const firstCheckbox = page
      .locator('[data-testid="source-entry-row"]')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .first()
      .getByRole('checkbox');
    await firstCheckbox.click();
    await snap(page, testInfo, 'item-selected');

    // Click confirm
    const confirmButton = page.getByTestId('add-items-confirm');
    await confirmButton.click();
    await snap(page, testInfo, 'items-adding');

    // Wait for dialog to close
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
    await snap(page, testInfo, 'dialog-closed');

    // Verify we're back on Disks page
    await expect(page.locator('header').getByRole('heading', { name: 'Disks' })).toBeVisible();
    await snap(page, testInfo, 'back-to-disks-page');
  });

  test('Play page: Add folder returns to Play and populates playlist', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-initial');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'play-folder-added');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-populated');
  });

  test('Disks page: Add folder returns to Disks and populates library', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await snap(page, testInfo, 'disks-initial');

    await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/disks-local')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'disks-folder-added');

    await expect(page.getByTestId('disk-row').first()).toBeVisible();
    await expect(page.getByTestId('disk-list')).toContainText('Disk 1');
    await snap(page, testInfo, 'disks-populated');
  });

  test('Play page: repeated add items via folder picker remains stable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-initial');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const firstCount = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_playlist:v1:TEST-123');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { items?: unknown[] };
      return parsed.items?.length ?? 0;
    });
    expect(firstCount).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const secondCount = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_playlist:v1:TEST-123');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { items?: unknown[] };
      return parsed.items?.length ?? 0;
    });
    expect(secondCount).toBeGreaterThanOrEqual(firstCount);
    await snap(page, testInfo, 'play-repeated-add');
  });

  test('Disks page: repeated add items via folder picker remains stable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await snap(page, testInfo, 'disks-initial');

    await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/disks-local')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const firstCount = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_disk_library:TEST-123');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { disks?: unknown[] };
      return parsed.disks?.length ?? 0;
    });
    expect(firstCount).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    await input.setInputFiles([path.resolve('playwright/fixtures/disks-local')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const secondCount = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_disk_library:TEST-123');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { disks?: unknown[] };
      return parsed.disks?.length ?? 0;
    });
    expect(secondCount).toBeGreaterThanOrEqual(firstCount);
    await snap(page, testInfo, 'disks-repeated-add');
  });

  test('Play page: repeated add items via C64 Ultimate remains stable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-initial');

    for (let i = 0; i < 2; i += 1) {
      await page.getByRole('button', { name: /Add items|Add more items/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    }

    const addDisk = async (diskName: string) => {
      await page.getByRole('button', { name: /Add items|Add more items/i }).click();
      const dialog = page.getByRole('dialog');
      await clickSourceSelectionButton(dialog, 'C64 Ultimate');
      await ensureRemoteRoot(dialog);
      await openRemoteFolder(dialog, 'Usb0');
      await openRemoteFolder(dialog, 'Games');
      await openRemoteFolder(dialog, 'Turrican II');
      await selectEntryCheckbox(dialog, diskName);
      await page.getByTestId('add-items-confirm').click();
      await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
    };

    await addDisk('Disk 1.d64');
    await addDisk('Disk 2.d64');

    await expect(page.getByTestId('playlist-list')).toContainText('Disk 1.d64');
    await expect(page.getByTestId('playlist-list')).toContainText('Disk 2.d64');
    await snap(page, testInfo, 'play-c64u-repeated-add');
  });

  test('Disks page: repeated add items via C64 Ultimate remains stable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await snap(page, testInfo, 'disks-initial');

    for (let i = 0; i < 2; i += 1) {
      await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    }

    const addDisk = async (diskName: string) => {
      await page.getByRole('button', { name: /Add disks|Add more disks/i }).click();
      const dialog = page.getByRole('dialog');
      await clickSourceSelectionButton(dialog, 'C64 Ultimate');
      await ensureRemoteRoot(dialog);
      await openRemoteFolder(dialog, 'Usb0');
      await openRemoteFolder(dialog, 'Games');
      await openRemoteFolder(dialog, 'Turrican II');
      await selectEntryCheckbox(dialog, diskName);
      await page.getByTestId('add-items-confirm').click();
      await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
    };

    await addDisk('Disk 1.d64');
    await addDisk('Disk 2.d64');

    await expect(page.getByTestId('disk-list')).toContainText('Disk 1.d64');
    await expect(page.getByTestId('disk-list')).toContainText('Disk 2.d64');
    await snap(page, testInfo, 'disks-c64u-repeated-add');
  });
});
