import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import type { Request } from 'playwright';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clickSourceSelectionButton } from './sourceSelection';
import { layoutTest, enforceDeviceTestMapping } from './layoutTest';

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

const openAddItemsDialog = async (page: Page) => {
  await page.getByRole('button', { name: /Add items|Add more items/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const getDiskList = (page: Page) => page.getByTestId('disk-list');

const openRemoteFolder = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
};

type SeedDisk = {
  id: string;
  name: string;
  path: string;
  location: 'local' | 'ultimate';
  group?: string | null;
  importOrder?: number | null;
};

const getDiskRow = (page: Page, name: string) =>
  getDiskList(page).getByTestId('disk-row').filter({ hasText: name }).first();

const openDiskMenu = async (page: Page, name: string) => {
  const row = getDiskRow(page, name);
  await row.getByRole('button', { name: 'Item actions' }).click();
};

const selectEntryCheckbox = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..');
  await row.getByRole('checkbox').click();
};

const addLocalFolder = async (page: Page, folderPath: string, diskNames: string[], expectVisible = true) => {
  await openAddItemsDialog(page);
  const dialog = page.getByRole('dialog');
  await clickSourceSelectionButton(dialog, 'This device');
  const input = page.locator('input[type="file"][webkitdirectory]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles(folderPath);
  await expect(page.getByRole('dialog')).toBeHidden();
  const overlay = page.locator('[data-testid="add-disks-overlay"]');
  try {
    await overlay.waitFor({ state: 'visible', timeout: 1500 });
  } catch {
    // Overlay may resolve quickly on small folders.
  }
  await overlay.waitFor({ state: 'detached' }).catch((): null => null);
  if (expectVisible) {
    for (const diskName of diskNames) {
      await expect(getDiskList(page)).toContainText(diskName);
    }
  }
};

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const getDriveCard = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator('..').locator('..').locator('..');

const seedDiskLibrary = async (page: Page, disks: SeedDisk[]) => {
  await page.addInitScript(({ disks: seedDisks }: { disks: SeedDisk[] }) => {
    const payload = {
      disks: seedDisks.map((disk: SeedDisk) => ({
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

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enforceDeviceTestMapping(testInfo);
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

  layoutTest('disks render with folder headers and no full paths @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64', 'Disk 2.d64']);
    await snap(page, testInfo, 'disks-added');

    const diskList = getDiskList(page);
    await expect(diskList.getByTestId('disk-row-header').filter({ hasText: '/Turrican II/' })).toBeVisible();
    const diskRow = getDiskRow(page, 'Disk 1.d64');
    await expect(diskRow).toBeVisible();
    await expect(diskRow).not.toContainText('/Turrican II/');
    await expect(getDiskRow(page, 'Disk 2.d64')).toBeVisible();
    await snap(page, testInfo, 'disk-list-grouped');
  });

  test('FTP directory listing shows hierarchy @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
    await openRemoteFolder(page, 'Usb0');
    await expect(page.getByText('Games', { exact: true })).toBeVisible();
    await expect(page.getByText('Demos', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-folders');
  });

  test('drive power toggle button updates state and issues request @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const requests: Array<{ method: string; url: string }> = [];
    page.on('request', (request: Request) => {
      try {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/v1/drives/') && (url.pathname.endsWith(':on') || url.pathname.endsWith(':off'))) {
          requests.push({ method: request.method(), url: url.pathname });
        }
      } catch {
        // Ignore malformed URLs.
      }
    });

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    const driveCard = getDriveCard(page, 'Drive A');
    const mountButton = driveCard.getByRole('button', { name: 'Mount…' });
    const powerButton = page.getByTestId('drive-power-toggle-a');

    await expect(powerButton).toBeVisible();
    await expect(powerButton).toHaveText('Turn Off');

    const [mountBox, powerBox] = await Promise.all([mountButton.boundingBox(), powerButton.boundingBox()]);
    if (mountBox && powerBox) {
      const xTolerance = 4;
      expect(powerBox.y).toBeGreaterThan(mountBox.y);
      expect(powerBox.x).toBeGreaterThanOrEqual(mountBox.x - xTolerance);
    }

    await powerButton.click();
    await expect(powerButton).toHaveText('Turn On');
    await expect(driveCard.getByText('OFF', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'drive-power-off');

    const lastRequest = getLatestDriveRequest(requests, (req) => req.url.endsWith('/v1/drives/a:off'));
    expect(lastRequest).toBeTruthy();
  });

  test('importing C64U folders preserves hierarchy and paths @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await openRemoteFolder(page, 'Usb0');
    await openRemoteFolder(page, 'Games');
    await openRemoteFolder(page, 'Turrican II');
    await snap(page, testInfo, 'c64u-folder');
    await selectEntryCheckbox(page, 'Disk 1.d64');
    await selectEntryCheckbox(page, 'Disk 2.d64');
    await selectEntryCheckbox(page, 'Disk 3.d64');
    await page.getByRole('button', { name: 'Add to library' }).click();
    await snap(page, testInfo, 'disks-imported');

    const diskList = getDiskList(page);

    await expect(diskList.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await expect(diskList.getByTestId('disk-row-header').filter({ hasText: '/Usb0/Games/Turrican II/' })).toBeVisible();
    await expect(getDiskRow(page, 'Disk 1.d64')).not.toContainText('/Usb0/Games/Turrican II/');
    await expect(diskList.getByLabel('C64U disk').first()).toBeVisible();
    await snap(page, testInfo, 'disk-list');
  });

  test('disk filtering greys out non-matching nodes and clears @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64', 'Disk 2.d64']);

    const filter = page.getByPlaceholder('Filter disks…');
    await filter.fill('Disk 1');

    const nonMatchRow = getDiskRow(page, 'Disk 2.d64');
    await expect(nonMatchRow).toHaveClass(/opacity-40/);
    await snap(page, testInfo, 'filter-applied');

    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(nonMatchRow).not.toHaveClass(/opacity-40/);
    await snap(page, testInfo, 'filter-cleared');
  });

  test('disk groups display and can be reassigned inline @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');

    await addLocalFolder(
      page,
      path.resolve('playwright/fixtures/disks-local/Groupings'),
      ['foo1.d64', 'foo2.d64', 'DiskA.d64', 'DiskB.d64', 'Last Ninja 3-1.d64'],
    );
    await snap(page, testInfo, 'disks-grouped');

    const fooRow = getDiskRow(page, 'foo1.d64');
    await expect(fooRow).toContainText('Group: foo');

    await openDiskMenu(page, 'foo1.d64');
    await page.getByRole('menuitem', { name: 'Set group…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^Disk/ }).click();
    await expect(fooRow).toContainText('Group: Disk');

    await openDiskMenu(page, 'DiskA.d64');
    await page.getByRole('menuitem', { name: 'Set group…' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Enter a group name').fill('My Group');
    await dialog.getByRole('button', { name: 'Create & assign' }).click();
    await expect(getDiskRow(page, 'DiskA.d64')).toContainText('Group: My Group');
    await snap(page, testInfo, 'disk-group-reassigned');
  });

  test('mounting ultimate disks uses mount endpoint @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedUltimateTurricanDisks(page);
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');

    const diskRow = getDiskRow(page, 'Disk 1.d64');
    await diskRow.getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    await page.getByRole('button', { name: /Drive A/i }).click();
    await snap(page, testInfo, 'mount-dialog');

    await expect.poll(() => Boolean(mountDriveRequest(server.requests, 'a'))).toBe(true);
    const remoteMount = mountDriveRequest(server.requests, 'a');
    expect(remoteMount?.method).toBe('PUT');
    expect(remoteMount?.url).toContain('image=%2FUsb0%2FGames%2FTurrican%20II%2FDisk%201.d64');
    await snap(page, testInfo, 'mount-requested');
  });

  test('multi-drive mounting and rotation within group @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedUltimateTurricanDisks(page);
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');

    await getDiskRow(page, 'Disk 1.d64').getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    await page
      .getByRole('dialog', { name: /Mount Disk 1\.d64/i })
      .getByRole('button', { name: /Drive A/i })
      .click();
    await expect.poll(() => Boolean(mountDriveRequest(server.requests, 'a'))).toBe(true);
    await snap(page, testInfo, 'mounted-drive-a');

    const nextButton = page.getByRole('button', { name: 'Next' }).first();
    await nextButton.click();
    await expect.poll(() =>
      server.requests.some((req) => req.url.includes('Disk%202.d64')),
    ).toBe(true);
    await snap(page, testInfo, 'rotated-disk');
  });

  test('mount dialog shows a single close button @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedUltimateTurricanDisks(page);
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');

    await getDiskRow(page, 'Disk 1.d64').getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    const dialog = page.getByRole('dialog', { name: /Mount Disk 1\.d64/i });
    await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(1);
    await snap(page, testInfo, 'single-close');
  });

  test('disk list view all shows full list @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '1');
    });
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64', 'Disk 2.d64'], false);
    await snap(page, testInfo, 'disks-added');

    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog', { name: 'All disks' });
    await expect(dialog.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Disk 2.d64', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'view-all');
    await snap(page, testInfo, 'disk-view-all');
  });

  test('disk view-all dialog is constrained and scrollable @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    const manyDisks = Array.from({ length: 220 }, (_, index) => ({
      id: `ultimate:/Usb0/Disks/Disk_${String(index + 1).padStart(3, '0')}.d64`,
      name: `Disk_${String(index + 1).padStart(3, '0')}.d64`,
      path: `/Usb0/Disks/Disk_${String(index + 1).padStart(3, '0')}.d64`,
      location: 'ultimate' as const,
      group: null as string | null,
      importOrder: index + 1,
    }));
    await seedDiskLibrary(page, manyDisks);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');

    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'disks-view-all-open');

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (dialogBox && viewport) {
      const heightRatio = dialogBox.height / viewport.height;
      const widthRatio = dialogBox.width / viewport.width;
      expect(heightRatio).toBeLessThan(0.9);
      expect(widthRatio).toBeLessThan(0.92);
      expect(dialogBox.y).toBeGreaterThan(viewport.height * 0.05);
      expect(dialogBox.y + dialogBox.height).toBeLessThan(viewport.height * 0.98);
    }

    const scrollArea = page.getByTestId('action-list-scroll');
    const scrollable = await scrollArea.evaluate((node: HTMLElement) => node.scrollHeight > node.clientHeight);
    expect(scrollable).toBeTruthy();
    await scrollArea.evaluate((node: HTMLElement) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(scrollArea).toContainText('Disk_220.d64');
    await snap(page, testInfo, 'disks-view-all-scrolled');
  });

  test('disk presence indicator and deletion ejects mounted disks @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedUltimateTurricanDisks(page);
    const encodedPath = encodeURIComponent('/Usb0/Games/Turrican II/Disk 1.d64');
    await page.request.put(`${server.baseUrl}/v1/drives/a:mount?image=${encodedPath}`);
    await page.goto('/disks', { waitUntil: 'commit' });
    await snap(page, testInfo, 'disks-open');

    const diskList = getDiskList(page);
    await getDiskRow(page, 'Disk 1.d64').getByRole('button', { name: 'Mount Disk 1.d64' }).click();
    await page
      .getByRole('dialog', { name: /Mount Disk 1\.d64/i })
      .getByRole('button', { name: /Drive A/i })
      .click();
    await snap(page, testInfo, 'mounted-drive-a');

    await expect.poll(() => Boolean(mountDriveRequest(server.requests, 'a'))).toBe(true);

    await openDiskMenu(page, 'Disk 1.d64');
    await page.getByRole('menuitem', { name: 'Remove from collection' }).click();
    await page.getByRole('dialog', { name: 'Remove disk?' }).getByRole('button', { name: 'Remove' }).click();
    await snap(page, testInfo, 'disk-removed');

    await expect.poll(() => Boolean(removeDriveRequest(server.requests, 'a'))).toBe(true);
    await snap(page, testInfo, 'drive-removed');
  });

  test('disk menu shows size/date and rename works @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64']);
    await snap(page, testInfo, 'disks-added');

    await openDiskMenu(page, 'Disk 1.d64');
    await expect(page.getByText('Size:', { exact: false })).toBeVisible();
    await expect(page.getByText('Date:', { exact: false })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Rename disk…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename disk' });
    await dialog.getByRole('textbox').fill('Disk One');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(getDiskList(page).getByText('Disk One', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'disk-renamed');
  });

  test('disk list select all removes selected items @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64', 'Disk 2.d64']);
    await snap(page, testInfo, 'disks-added');

    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByRole('button', { name: 'Remove selected items' }).click();
    const dialog = page.getByRole('dialog', { name: /Remove selected disks/i });
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(getDiskList(page)).toContainText('No disks in the collection yet.');
    await snap(page, testInfo, 'disks-removed');
  });

  test('disk view-all filter narrows list @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    const manyDisks = Array.from({ length: 12 }, (_, index) => ({
      id: `ultimate:/Usb0/Disks/Disk_${String(index + 1).padStart(3, '0')}.d64`,
      name: `Disk_${String(index + 1).padStart(3, '0')}.d64`,
      path: `/Usb0/Disks/Disk_${String(index + 1).padStart(3, '0')}.d64`,
      location: 'ultimate' as const,
      group: null as string | null,
      importOrder: index + 1,
    }));
    await seedDiskLibrary(page, manyDisks);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const filter = page.getByTestId('view-all-filter-input');
    await filter.fill('Disk_005');
    await snap(page, testInfo, 'disk-view-all-filtered');

    await expect(page.getByTestId('action-list-scroll')).toContainText('Disk_005.d64');
    await expect(page.getByTestId('action-list-scroll')).not.toContainText('Disk_001.d64');
  });

  test('disk removal wording is non-destructive @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64']);

    await openDiskMenu(page, 'Disk 1.d64');
    await expect(page.getByRole('menuitem', { name: /Remove from collection/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete disk/i })).toHaveCount(0);
    await snap(page, testInfo, 'menu-verified');
  });

  test('disk menu shows size and date for local imports @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await addLocalFolder(page, path.resolve('playwright/fixtures/disks-local/Turrican II'), ['Disk 1.d64']);

    await openDiskMenu(page, 'Disk 1.d64');
    const sizeItem = page.getByRole('menuitem', { name: /Size:/i });
    const dateItem = page.getByRole('menuitem', { name: /Date:/i });
    await expect(sizeItem).toBeVisible();
    await expect(dateItem).toBeVisible();
    await expect(sizeItem).not.toContainText('—');
    await expect(dateItem).not.toContainText('—');
    await snap(page, testInfo, 'local-disk-size-date');
  });

  test('disk menu shows size and date for C64 Ultimate imports @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await openRemoteFolder(page, 'Usb0');
    await openRemoteFolder(page, 'Games');
    await openRemoteFolder(page, 'Turrican II');
    await selectEntryCheckbox(page, 'Disk 1.d64');
    await page.getByRole('button', { name: 'Add to library' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await openDiskMenu(page, 'Disk 1.d64');
    const sizeItem = page.getByRole('menuitem', { name: /Size:/i });
    const dateItem = page.getByRole('menuitem', { name: /Date:/i });
    await expect(sizeItem).toBeVisible();
    await expect(dateItem).toBeVisible();
    await expect(sizeItem).not.toContainText('—');
    await expect(dateItem).not.toContainText('—');
    await snap(page, testInfo, 'ftp-disk-size-date');
  });

  test('importing non-disk files shows warning @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected warning for non-disk file imports.');
    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles(path.resolve('playwright/fixtures/disks-local/EmptyFolder'));
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('No matching items in this folder.', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'no-disks-warning');
  });

  test('FTP login failure surfaces error @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for FTP login failure.');
    const protectedServers = await startFtpTestServers({ password: 'secret' });
    await seedFtpConfig(page, {
      host: protectedServers.ftpServer.host,
      port: protectedServers.ftpServer.port,
      bridgeUrl: protectedServers.bridgeServer.baseUrl,
      password: 'wrong',
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await expect(page.getByText('Browse failed', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'browse-failed');

    await protectedServers.close();
  });

  test('FTP server unavailable surfaces error @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for FTP server unavailable.');
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port + 50,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'disks-open');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await expect(page.getByText('Browse failed', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'browse-failed');
  });
});
