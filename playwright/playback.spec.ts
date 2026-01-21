import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, startStrictUiMonitoring } from './testArtifacts';

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

const openAddItemsDialog = async (page: Page) => {
  await page.getByRole('button', { name: /Add items|Add more items/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const selectEntryCheckbox = async (container: Page | Locator, name: string) => {
  const row = container.getByText(name, { exact: true }).locator('..').locator('..');
  await row.getByRole('checkbox').click();
};

const openRemoteFolder = async (container: Page | Locator, name: string) => {
  const row = container.getByText(name, { exact: true }).locator('..').locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
};

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

test.describe('Playback file browser', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

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
    await assertNoUiIssues(page, testInfo);
    await server.close();
  });

  test('play page is available from tab bar', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await snap(page, testInfo, 'play-page-loaded');
  });

  test('local browsing filters supported files and plays SID upload', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-open');
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-populated');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    expect(server.sidplayRequests[0].method).toBe('POST');
    await snap(page, testInfo, 'sid-playback-requested');
  });

  test('local source browser filters supported files', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'local-source-added');

    await openAddItemsDialog(page);
    await expect(page.getByRole('button', { name: 'local-play' })).toBeVisible();
    await page.getByRole('button', { name: 'local-play' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('demo.sid', { exact: true })).toBeVisible();
    await expect(dialog.getByText('demo.txt')).toHaveCount(0);
    await snap(page, testInfo, 'local-source-browser');
  });

  test('folder play populates playlist dialog', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '1');
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-preview');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.d64');
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('demo.sid', { exact: true })).toBeVisible();
    await expect(dialog.getByText('demo.d64', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'playlist-view-all');
  });

  test('local folder input accepts directory', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-populated');
  });

  test('local folder without supported files shows warning', async ({ page }: { page: Page }, testInfo) => {
    allowWarnings(testInfo, 'Expected warning when no supported files are found.');
    await page.goto('/play');
    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-open');
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-unsupported')]);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('add-items-progress')).toContainText('No supported files');
    await snap(page, testInfo, 'no-supported-files');
  });

  test('ultimate browsing lists FTP entries and mounts remote disk image', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await openRemoteFolder(dialog, 'Turrican II');
    await expect(dialog.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-folder');
    await selectEntryCheckbox(dialog, 'Disk 1.d64');
    await page.getByTestId('add-items-confirm').click();
    await snap(page, testInfo, 'playlist-updated');
    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'Disk 1.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'mount-requested');
  });

  test('C64U browser remembers last path and supports root', async ({ page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    const dialog = page.getByRole('dialog');
    await ensureRemoteRoot(page);
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await expect(dialog.getByText(/Path: \/Usb0\/Games/)).toBeVisible();
    await snap(page, testInfo, 'c64u-path-remembered');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await snap(page, testInfo, 'dialog-closed');

    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await expect(page.getByText(/Path: \/Usb0\/Games/)).toBeVisible();
    await page.getByTestId('navigate-root').click();
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
  });

  test('disk image triggers mount and autostart sequence', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');
    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/machine:readmem')),
    );
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/machine:writemem')),
    );
    await snap(page, testInfo, 'autostart-complete');
  });

  test('FTP failure shows error toast', async ({ page }: { page: Page }, testInfo) => {
    allowWarnings(testInfo, 'Expected error toast for FTP failure.');
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port + 25,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await expect(page.getByText('Browse failed', { exact: true }).first()).toBeVisible();
    await snap(page, testInfo, 'browse-failed');
  });

  test('end-to-end add, browse, and play (local + remote)', async ({ page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page');
    await snap(page, testInfo, 'play-open');

    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-dialog');
    await snap(page, testInfo, 'add-items-open');

    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'local-library-added');
    await snap(page, testInfo, 'local-playlist-updated');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    await snap(page, testInfo, 'local-playback');
    await snap(page, testInfo, 'local-playback-started');

    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await openRemoteFolder(dialog, 'Turrican II');
    await snap(page, testInfo, 'remote-browser');
    await snap(page, testInfo, 'remote-browser');

    await selectEntryCheckbox(dialog, 'Disk 1.d64');
    await page.getByTestId('add-items-confirm').click();
    await snap(page, testInfo, 'remote-library-added');
    await snap(page, testInfo, 'remote-playlist-updated');

    await expect(page.getByTestId('playlist-list')).toContainText('Disk 1.d64');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'Disk 1.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'remote-playback');
    await snap(page, testInfo, 'remote-playback-started');
  });

  test('add to playlist queues items without auto-play', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await expect.poll(() => server.sidplayRequests.length).toBe(0);
    await snap(page, testInfo, 'no-autoplay');
  });

  test('prev/next navigates within playlist', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'first-track-playing');

    await page.getByTestId('playlist-next').click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    await snap(page, testInfo, 'next-track-playing');

    await page.getByTestId('playlist-prev').click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/drives/a:mount')).length > 1,
    );
    await snap(page, testInfo, 'prev-track-playing');
  });

  test('transport controls toggle play, pause, and stop', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    const playButton = page.getByTestId('playlist-play');
    const pauseButton = page.getByTestId('playlist-pause');
    await expect(playButton).toBeDisabled();
    await expect(pauseButton).toBeDisabled();

    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    const before = await Promise.all([
      page.getByTestId('playlist-prev').boundingBox(),
      playButton.boundingBox(),
      pauseButton.boundingBox(),
      page.getByTestId('playlist-next').boundingBox(),
    ]);

    await expect(playButton).toBeEnabled();
    await playButton.click();
    await waitForRequests(() =>
      server.sidplayRequests.length > 0 ||
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'play-started');
    await expect(playButton).toContainText('Stop');
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(pauseButton).toContainText('Resume');
    await snap(page, testInfo, 'paused');
    await playButton.click();
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'stopped');

    const after = await Promise.all([
      page.getByTestId('playlist-prev').boundingBox(),
      playButton.boundingBox(),
      pauseButton.boundingBox(),
      page.getByTestId('playlist-next').boundingBox(),
    ]);

    expect(after.map((box) => box?.x)).toEqual(before.map((box) => box?.x));
  });

  test('playlist selection supports select all and remove selected', async ({ page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByRole('button', { name: 'Remove selected items' }).click();
    await expect(page.getByTestId('playlist-list')).toContainText('No tracks in playlist yet.');
    await snap(page, testInfo, 'playlist-cleared');
    await snap(page, testInfo, 'playlist-removed');
  });

  test('playlist persists after reload', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-saved');

    await page.reload();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-restored');
  });

  test('upload handler tolerates empty/binary response', async ({ page }: { page: Page }, testInfo) => {
    let sidplayCalls = 0;
    await page.route('**/v1/runners:sidplay**', async (route) => {
      sidplayCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from([0, 0, 0, 0, 1, 2, 3]),
      });
    });

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await expect.poll(() => sidplayCalls).toBeGreaterThan(0);
    await snap(page, testInfo, 'sid-uploaded');
  });
});
