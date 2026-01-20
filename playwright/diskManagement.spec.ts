import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';

const getLatestDriveRequest = (
  requests: Array<{ method: string; url: string }>,
  matcher: (req: { method: string; url: string }) => boolean,
) => [...requests].reverse().find(matcher);

const mountDriveRequest = (requests: Array<{ method: string; url: string }>, drive: 'a' | 'b') =>
  getLatestDriveRequest(
    requests,
    (req) => req.url.startsWith(`/v1/drives/${drive}:mount`) && req.method !== 'OPTIONS',
  );

const removeDriveRequest = (requests: Array<{ method: string; url: string }>, drive: 'a' | 'b') =>
  getLatestDriveRequest(
    requests,
    (req) => req.url.startsWith(`/v1/drives/${drive}:remove`) && req.method !== 'OPTIONS',
  );

const openLocalDialog = async (page: Page) => {
  await page.getByRole('button', { name: /Add from local device/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const getDiskLibrary = (page: Page) => page.getByTestId('disk-library-tree');

const openRemoteFolder = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
};

const getDiskRow = (page: Page, name: string) =>
  getDiskLibrary(page).getByText(name, { exact: true }).locator('..').locator('..').locator('..');

const getDiskRowByPath = (page: Page, pathText: string) =>
  getDiskLibrary(page).getByText(pathText, { exact: true }).locator('..').locator('..').locator('..');

const openDiskMenu = async (page: Page, name: string) => {
  const row = getDiskRow(page, name);
  await row.getByRole('button', { name: 'Disk actions' }).click();
};

const importCurrentRemoteFolder = async (page: Page, path: string) => {
  const row = page.getByText(`Path: ${path}`).locator('..');
  await row.getByRole('button', { name: 'Import' }).click();
};

const addLocalFolder = async (page: Page, folderPath: string) => {
  await openLocalDialog(page);
  const input = page.locator('input[type="file"][webkitdirectory]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles(folderPath);
};

const seedDiskLibrary = async (page: Page, disks: Array<{ id: string; name: string; path: string; location: 'local' | 'ultimate'; group?: string | null; importOrder?: number | null }>) => {
  await page.addInitScript(({ disks: seedDisks }) => {
    const payload = {
      disks: seedDisks.map((disk) => ({
        ...disk,
        group: disk.group ?? null,
        importOrder: disk.importOrder ?? null,
        importedAt: new Date().toISOString(),
      })),
    };
    localStorage.setItem('c64u_disk_library:TEST-123', JSON.stringify(payload));
  }, { disks });
};

const seedUltimateTurricanDisks = async (page: Page) => {
  await seedDiskLibrary(page, [
    {
      id: 'ultimate:/Usb0/Games/Turrican II/Disk 1.d64',
      name: 'Disk 1.d64',
      path: '/Usb0/Games/Turrican II/Disk 1.d64',
      location: 'ultimate',
      group: 'Turrican II',
      importOrder: 1,
    },
    {
      id: 'ultimate:/Usb0/Games/Turrican II/Disk 2.d64',
      name: 'Disk 2.d64',
      path: '/Usb0/Games/Turrican II/Disk 2.d64',
      location: 'ultimate',
      group: 'Turrican II',
      importOrder: 2,
    },
    {
      id: 'ultimate:/Usb0/Games/Turrican II/Disk 3.d64',
      name: 'Disk 3.d64',
      path: '/Usb0/Games/Turrican II/Disk 3.d64',
      location: 'ultimate',
      group: 'Turrican II',
      importOrder: 3,
    },
  ]);
};

test.describe('Disk management', () => {
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

  test('importing local folders preserves hierarchy and groups', async ({ page }: { page: Page }) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'));

    const diskLibrary = getDiskLibrary(page);

    await expect(diskLibrary.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await expect(diskLibrary.getByText('Disk 2.d64', { exact: true })).toBeVisible();
    await expect(diskLibrary.getByText('Group: Turrican II')).toHaveCount(2);
    await expect(diskLibrary.getByText('Turrican II', { exact: true })).toBeVisible();
  });

  test('FTP directory listing shows hierarchy', async ({ page }: { page: Page }) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add from C64 Ultimate/i }).click();
    await expect(page.getByText('Browse C64 Ultimate')).toBeVisible();
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await openRemoteFolder(page, 'Usb0');
    await expect(page.getByText('Games', { exact: true })).toBeVisible();
    await expect(page.getByText('Demos', { exact: true })).toBeVisible();
  });

  test('importing C64U folders preserves hierarchy and paths', async ({ page }: { page: Page }) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add from C64 Ultimate/i }).click();
    await expect(page.getByText('Browse C64 Ultimate')).toBeVisible();
    await openRemoteFolder(page, 'Usb0');
    await openRemoteFolder(page, 'Games');
    await openRemoteFolder(page, 'Turrican II');
    await importCurrentRemoteFolder(page, '/Usb0/Games/Turrican II');
    await page
      .getByRole('dialog', { name: 'Browse C64 Ultimate' })
      .getByRole('button', { name: 'Close' })
      .click();

    const diskLibrary = getDiskLibrary(page);

    await expect(diskLibrary.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await expect(diskLibrary.getByText('/Usb0/Games/Turrican II/Disk 1.d64')).toBeVisible();
    await expect(diskLibrary.getByText('Group: Turrican II')).toHaveCount(3);
    await expect(diskLibrary.getByLabel('C64U disk').first()).toBeVisible();
  });

  test('disk filtering greys out non-matching nodes and clears', async ({ page }: { page: Page }) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'));

    const filter = page.getByPlaceholder('Filter disks…');
    await filter.fill('Disk 1');

    const nonMatchRow = getDiskRow(page, 'Disk 2.d64');
    await expect(nonMatchRow).toHaveClass(/opacity-40/);

    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(nonMatchRow).not.toHaveClass(/opacity-40/);
  });

  test('mounting ultimate disks uses mount endpoint', async ({ page }: { page: Page }) => {
    await seedUltimateTurricanDisks(page);
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });

    const diskRow = getDiskRowByPath(page, '/Usb0/Games/Turrican II/Disk 1.d64');
    await diskRow.getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    await page.getByRole('button', { name: /Drive A/i }).click();

    await expect.poll(() => Boolean(mountDriveRequest(server.requests, 'a'))).toBe(true);
    const remoteMount = mountDriveRequest(server.requests, 'a');
    expect(remoteMount?.method).toBe('PUT');
    expect(remoteMount?.url).toContain('image=%2FUsb0%2FGames%2FTurrican%20II%2FDisk%201.d64');
  });

  test('multi-drive mounting and rotation within group', async ({ page }: { page: Page }) => {
    await seedUltimateTurricanDisks(page);
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });

    await getDiskRow(page, 'Disk 1.d64').getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    await page
      .getByRole('dialog', { name: /Mount Disk 1\.d64/i })
      .getByRole('button', { name: /Drive A/i })
      .click();
    await expect.poll(() => Boolean(mountDriveRequest(server.requests, 'a'))).toBe(true);

    const nextButton = page.getByRole('button', { name: 'Next' }).first();
    await nextButton.click();
    await expect.poll(() =>
      server.requests.some((req) => req.url.includes('Disk%202.d64')),
    ).toBe(true);
  });

  test('disk presence indicator and deletion ejects mounted disks', async ({ page }: { page: Page }) => {
    await seedUltimateTurricanDisks(page);
    const encodedPath = encodeURIComponent('/Usb0/Games/Turrican II/Disk 1.d64');
    await page.request.put(`${server.baseUrl}/v1/drives/a:mount?image=${encodedPath}`);
    await page.goto('/disks', { waitUntil: 'commit' });

    const diskLibrary = getDiskLibrary(page);
    await getDiskRow(page, 'Disk 1.d64').getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    await page
      .getByRole('dialog', { name: /Mount Disk 1\.d64/i })
      .getByRole('button', { name: /Drive A/i })
      .click();

    await expect.poll(() => Boolean(mountDriveRequest(server.requests, 'a'))).toBe(true);

    await openDiskMenu(page, 'Disk 1.d64');
    await page.getByRole('menuitem', { name: 'Delete disk' }).click();
    await page.getByRole('dialog', { name: 'Delete disk?' }).getByRole('button', { name: 'Delete' }).click();

    await expect.poll(() => Boolean(removeDriveRequest(server.requests, 'a'))).toBe(true);
  });

  test('disk menu shows size/date and rename works', async ({ page }: { page: Page }) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'));

    await openDiskMenu(page, 'Disk 1.d64');
    await expect(page.getByText('Size:', { exact: false })).toBeVisible();
    await expect(page.getByText('Date:', { exact: false })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Rename disk…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename disk' });
    await dialog.getByRole('textbox').fill('Disk One');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(getDiskLibrary(page).getByText('Disk One', { exact: true })).toBeVisible();
  });

  test('importing non-disk files shows warning', async ({ page }: { page: Page }) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await openLocalDialog(page);
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles(path.resolve('playwright/fixtures/disks-local/EmptyFolder'));
    await expect(page.getByText('Found no disk file.', { exact: true })).toBeVisible();
  });

  test('FTP login failure surfaces error', async ({ page }: { page: Page }) => {
    const protectedServers = await startFtpTestServers({ password: 'secret' });
    await seedFtpConfig(page, {
      host: protectedServers.ftpServer.host,
      port: protectedServers.ftpServer.port,
      bridgeUrl: protectedServers.bridgeServer.baseUrl,
      password: 'wrong',
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add from C64 Ultimate/i }).click();
    await expect(page.getByText('FTP browse failed', { exact: true })).toBeVisible();

    await protectedServers.close();
  });

  test('FTP server unavailable surfaces error', async ({ page }: { page: Page }) => {
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port + 50,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Add from C64 Ultimate/i }).click();
    await expect(page.getByText('FTP browse failed', { exact: true })).toBeVisible();
  });
});
