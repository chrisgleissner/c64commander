import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

const openRemoteFolder = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..');
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

  test('home shows Play section between Machine and Config', async ({ page }: { page: Page }) => {
    await page.goto('/');
    const machine = page.getByRole('heading', { name: 'Machine' });
    const play = page.getByRole('heading', { name: 'Play' });
    const config = page.getByRole('heading', { name: 'Config' });

    await expect(machine).toBeVisible();
    await expect(play).toBeVisible();
    await expect(config).toBeVisible();

    const machineBox = await machine.boundingBox();
    const playBox = await play.boundingBox();
    const configBox = await config.boundingBox();

    expect(machineBox && playBox && configBox).toBeTruthy();
    if (machineBox && playBox && configBox) {
      expect(machineBox.y).toBeLessThan(playBox.y);
      expect(playBox.y).toBeLessThan(configBox.y);
    }
  });

  test('local browsing filters supported files and plays SID upload', async ({ page }: { page: Page }) => {
    await page.goto('/play?source=local');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder' }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles([path.resolve('playwright/fixtures/local-play')]);

    await page.getByRole('button', { name: 'local-play/' }).click();
    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();
    await expect(page.getByText('demo.txt')).toHaveCount(0);

    await page.getByText('demo.sid', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    expect(server.sidplayRequests[0].method).toBe('POST');
  });

  test('local file picker accepts individual files', async ({ page }: { page: Page }) => {
    await page.goto('/play?source=local');
    const input = page.getByTestId('play-file-input');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play/demo.sid')]);

    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();
    await page.getByText('demo.sid', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
  });

  test('local folder without supported files shows warning', async ({ page }: { page: Page }) => {
    await page.goto('/play?source=local');
    const folderInput = page.getByTestId('play-folder-input');
    await folderInput.setInputFiles([path.resolve('playwright/fixtures/local-play-unsupported')]);
    await expect(page.getByText('Found no supported files.', { exact: true })).toBeVisible();
  });

  test('ultimate browsing lists FTP entries and mounts remote disk image', async ({ page }: { page: Page }) => {
    await page.goto('/play?source=ultimate');
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await openRemoteFolder(page, 'Usb0');
    await openRemoteFolder(page, 'Games');
    await openRemoteFolder(page, 'Turrican II');
    await expect(page.getByText('Disk 1.d64', { exact: true })).toBeVisible();

    await page.getByText('Disk 1.d64', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
  });

  test('disk image triggers mount and autostart sequence', async ({ page }: { page: Page }) => {
    await page.goto('/play?source=local');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder' }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles([path.resolve('playwright/fixtures/local-play')]);

    await page.getByRole('button', { name: 'local-play/' }).click();
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

    await page.goto('/play?source=ultimate');
    await expect(page.getByText('FTP browse failed', { exact: true }).first()).toBeVisible();
  });
});
