import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

test.describe('Playback file browser', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }) => {
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test('home shows Play section between Machine Control and Configuration', async ({ page }: { page: Page }) => {
    await page.goto('/');
    const machine = page.getByRole('heading', { name: 'Machine Control' });
    const play = page.getByRole('heading', { name: 'Play' });
    const config = page.getByRole('heading', { name: 'Configuration' });

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

  test('ultimate browsing lists FTP entries and plays remote SID', async ({ page }: { page: Page }) => {
    await page.goto('/play?source=ultimate');
    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();

    await page.getByText('demo.sid', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    expect(server.sidplayRequests[0].method).toBe('PUT');
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
    await page.addInitScript(() => {
      window.__ftpMock__ = {
        listDirectory: async () => {
          throw new Error('FTP unreachable');
        },
      };
    });

    await page.goto('/play?source=ultimate');
    await expect(page.getByText('FTP browse failed', { exact: true }).first()).toBeVisible();
  });
});
