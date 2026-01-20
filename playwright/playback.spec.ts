import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

const openAddItemsDialog = async (page: Page) => {
  await page.getByRole('button', { name: /Add items|Add more items/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const selectEntryCheckbox = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..');
  await row.getByRole('checkbox').click();
};

const openRemoteFolder = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
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

  test.beforeEach(async ({ page }: { page: Page }) => {
    server = await createMockC64Server({});
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test('play page is available from tab bar', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
  });

  test('local browsing filters supported files and plays SID upload', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await page.getByRole('button', { name: 'local-play' }).click();
    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();
    await expect(page.getByText('demo.txt')).toHaveCount(0);
    await selectEntryCheckbox(page, 'demo.sid');
    await page.getByRole('button', { name: 'Add to library' }).click();

    await page.getByText('demo.sid', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    expect(server.sidplayRequests[0].method).toBe('POST');
  });

  test('folder play populates playlist dialog', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await page.getByRole('button', { name: 'local-play' }).click();
    await selectEntryCheckbox(page, 'demo.sid');
    await selectEntryCheckbox(page, 'demo.d64');
    await page.getByRole('button', { name: 'Add to library' }).click();

    await page.getByRole('button', { name: 'Play library' }).click();
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('demo.sid', { exact: true })).toBeVisible();
  });

  test('local folder input accepts directory', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await page.getByRole('button', { name: 'local-play' }).click();
    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();
  });

  test('local folder without supported files shows warning', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-unsupported')]);
    await page.getByRole('button', { name: 'local-play-unsupported' }).click();
    await expect(page.getByText('No matching items in this folder.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add to library' }).click();
    await expect(page.getByRole('dialog').getByText('Select items', { exact: true })).toBeVisible();
  });

  test('ultimate browsing lists FTP entries and mounts remote disk image', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await openRemoteFolder(page, 'Usb0');
    await openRemoteFolder(page, 'Games');
    await openRemoteFolder(page, 'Turrican II');
    await expect(page.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await selectEntryCheckbox(page, 'Disk 1.d64');
    await page.getByRole('button', { name: 'Add to library' }).click();
    await page.getByText('Disk 1.d64', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
  });

  test('disk image triggers mount and autostart sequence', async ({ page }: { page: Page }) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await page.getByRole('button', { name: 'local-play' }).click();
    await selectEntryCheckbox(page, 'demo.d64');
    await page.getByRole('button', { name: 'Add to library' }).click();
    await page.getByText('demo.d64', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/machine:readmem')),
    );
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/machine:writemem')),
    );
  });

  test('FTP failure shows error toast', async ({ page }: { page: Page }) => {
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
  });
});
