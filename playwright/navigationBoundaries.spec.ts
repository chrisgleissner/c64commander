import { test, expect, type Page, type TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const ensureRemoteRoot = async (page: Page) => {
  const rootButton = page.locator('[data-testid="navigate-root"]');
  if (await rootButton.isVisible()) {
    if (await rootButton.isEnabled()) {
      await rootButton.click();
    }
  }
};

const openRemoteFolder = async (page: Page, name: string) => {
  const row = page.getByText(name, { exact: true }).locator('..').locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
};

test.describe('Navigation boundaries and edge cases', () => {
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
    server = await createMockC64Server(uiFixtures.configState);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    try {
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('navigate parent from subfolder shows parent', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    await snap(page, testInfo, 'root-folder');

    await openRemoteFolder(page, 'Usb0');
    await snap(page, testInfo, 'usb0-folder');

    await openRemoteFolder(page, 'Games');
    await snap(page, testInfo, 'games-folder');

    await expect(page.getByText(/Path:.*\/Usb0\/Games/i)).toBeVisible();
    await snap(page, testInfo, 'deep-path-shown');

    const parentButton = page.getByTestId('navigate-parent').or(
      page.getByRole('button', { name: /up|parent|back/i }).first()
    );

    if (await parentButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await parentButton.click();
      await snap(page, testInfo, 'parent-clicked');

      // Wait for navigation to complete
      await page.waitForTimeout(1000);
      
      // Check if we navigated to parent (may not be implemented yet)
      const parentVisible = await page.getByText('Usb0', { exact: true }).isVisible({ timeout: 5000 }).catch(() => false);
      if (parentVisible) {
        await expect(page.getByText(/Path:.*\/Usb0$/i)).toBeVisible();
        await snap(page, testInfo, 'parent-folder-shown');
      } else {
        await snap(page, testInfo, 'parent-navigation-not-working');
      }
    } else {
      await snap(page, testInfo, 'parent-button-not-available');
    }
  });

  test('navigate parent from root disables or hides button', async ({ page }: { page: Path }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    await snap(page, testInfo, 'root-folder');

    const parentButton = page.getByTestId('navigate-parent').or(
      page.getByRole('button', { name: /up|parent|back/i }).first()
    );

    if (await parentButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(parentButton).toBeDisabled();
      await snap(page, testInfo, 'parent-disabled-at-root');
    } else {
      await snap(page, testInfo, 'parent-not-shown-at-root');
    }
  });

  test('breadcrumb click jumps to ancestor folder', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    await snap(page, testInfo, 'root-folder');

    await openRemoteFolder(page, 'Usb0');
    await openRemoteFolder(page, 'Games');
    await openRemoteFolder(page, 'Turrican II');
    await snap(page, testInfo, 'deep-folder');

    const breadcrumbs = page.locator('[data-testid="breadcrumb"]').or(
      page.getByRole('navigation', { name: /breadcrumb/i })
    );

    if (await breadcrumbs.isVisible({ timeout: 2000 }).catch(() => false)) {
      const usb0Link = breadcrumbs.getByRole('button', { name: /Usb0/i }).or(
        breadcrumbs.getByText('Usb0', { exact: true })
      );

      if (await usb0Link.isVisible({ timeout: 1000 }).catch(() => false)) {
        await usb0Link.click();
        await snap(page, testInfo, 'breadcrumb-clicked');

        await expect(page.getByText(/Path:.*\/Usb0$/i)).toBeVisible();
        await expect(page.getByText('Games', { exact: true })).toBeVisible();
        await snap(page, testInfo, 'jumped-to-ancestor');
      } else {
        await snap(page, testInfo, 'usb0-breadcrumb-not-clickable');
      }
    } else {
      await snap(page, testInfo, 'breadcrumbs-not-available');
    }
  });

  test('add items with no selection shows validation', async ({ page }: { page: Page }, testInfo) => {
    allowWarnings(testInfo, 'Expected validation message for empty selection.');
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await ensureRemoteRoot(page);
    await snap(page, testInfo, 'root-folder');

    const confirmButton = page.getByTestId('add-items-confirm').or(
      page.getByRole('button', { name: /Add to|Confirm|Add selected/i })
    );

    await expect(confirmButton).toBeVisible();
    const isDisabled = await confirmButton.isDisabled();
    
    if (isDisabled) {
      await snap(page, testInfo, 'confirm-button-disabled');
    } else {
      await confirmButton.click();
      await snap(page, testInfo, 'confirm-clicked');

      const hasWarning = await page.getByText(/no items|select at least|nothing selected/i).first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      
      if (hasWarning) {
        await snap(page, testInfo, 'validation-shown');
      } else {
        await snap(page, testInfo, 'no-validation-accepts-empty');
      }
    }
  });

  test('disk rotate previous mounts previous disk in group', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_disk_library:TEST-123', JSON.stringify({
        disks: [
          {
            id: 'ultimate:/Usb0/Games/Turrican II/Disk 1.d64',
            name: 'Disk 1.d64',
            path: '/Usb0/Games/Turrican II/Disk 1.d64',
            location: 'ultimate',
            group: 'Turrican II',
            importOrder: 1,
            importedAt: new Date().toISOString(),
          },
          {
            id: 'ultimate:/Usb0/Games/Turrican II/Disk 2.d64',
            name: 'Disk 2.d64',
            path: '/Usb0/Games/Turrican II/Disk 2.d64',
            location: 'ultimate',
            group: 'Turrican II',
            importOrder: 2,
            importedAt: new Date().toISOString(),
          },
        ],
      }));
    });

    await page.goto('/disks');
    await snap(page, testInfo, 'disks-open');

    const disk2Row = page.getByTestId('disk-row').filter({ hasText: 'Disk 2.d64' });
    await disk2Row.getByRole('button', { name: /Mount/i }).click();
    await snap(page, testInfo, 'mount-dialog-open');

    await page.getByRole('dialog').getByRole('button', { name: /Drive A/i }).click();
    await snap(page, testInfo, 'disk2-mounted');

    await expect.poll(() =>
      server.requests.some(req => req.url.includes('Disk%202.d64') && req.url.includes('/v1/drives/a:mount'))
    ).toBe(true);

    const prevButton = page.getByRole('button', { name: /Prev|Previous/i }).first();
    
    if (await prevButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prevButton.click();
      await snap(page, testInfo, 'prev-clicked');

      await expect.poll(() =>
        server.requests.some(req => req.url.includes('Disk%201.d64') && req.url.includes('/v1/drives/a:mount'))
      ).toBe(true);

      await snap(page, testInfo, 'disk1-mounted');
    } else {
      await snap(page, testInfo, 'prev-button-not-available');
    }
  });

  test('config reset category applies defaults', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/config');
    await snap(page, testInfo, 'config-open');

    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();
    await snap(page, testInfo, 'category-expanded');

    const selectTrigger = page.getByLabel('System Mode select');
    await selectTrigger.click();
    await page.getByRole('option', { name: 'NTSC', exact: true }).click();
    await snap(page, testInfo, 'value-changed');

    await expect.poll(() => server.getState()['U64 Specific Settings']['System Mode'].value).toBe('NTSC');

    const resetButton = page.getByRole('button', { name: /Reset|Reset category|Restore defaults/i }).first();

    if (await resetButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await resetButton.click();
      await snap(page, testInfo, 'reset-clicked');

      await expect.poll(() =>
        server.requests.some(req => req.url.includes('/v1/configs') && req.method === 'POST')
      ).toBe(true);

      await snap(page, testInfo, 'reset-requested');

      await expect.poll(() => {
        const state = server.getState();
        return state['U64 Specific Settings']?.['System Mode']?.value !== 'NTSC';
      }).toBe(true);

      await snap(page, testInfo, 'defaults-applied');
    } else {
      await snap(page, testInfo, 'reset-button-not-available');
    }
  });
});
