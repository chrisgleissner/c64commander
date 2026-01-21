import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring, allowWarnings } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const openSaveDialog = async (page: Page) => {
  // Click the "Save to App" QuickActionCard (label="Save", description="To App")
  await page.getByText('To App').click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const openLoadDialog = async (page: Page) => {
  // Click the "Load from App" QuickActionCard (label="Load", description="From App")
  // There are two "Load" cards, we want the second one (first is "From flash", second is "From App")
  await page.getByText('From App').click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const openManageDialog = async (page: Page) => {
  // Click the "Manage" QuickActionCard (label="Manage", description="App Configs")
  // Need to wait for it to be enabled (requires appConfigs.length > 0)
  await page.getByRole('button').filter({ has: page.getByText('App Configs') }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button').filter({ has: page.getByText('App Configs') }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

test.describe('Home page app config management', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.removeItem('c64u_app_configs');
    });
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('save config with valid name stores in localStorage', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openSaveDialog(page);
    await snap(page, testInfo, 'save-dialog-open');

    const nameInput = page.getByRole('dialog').getByRole('textbox', { name: /name|config name/i });
    await nameInput.fill('My Test Config');
    await snap(page, testInfo, 'name-entered');

    await page.getByRole('dialog').getByRole('button', { name: /save|confirm/i }).click();
    await expect(page.getByRole('dialog', { name: /Save/i })).toBeHidden();
    await snap(page, testInfo, 'dialog-closed');

    await expect(page.getByText(/Saved to app|Config saved/i).first()).toBeVisible();
    await snap(page, testInfo, 'toast-shown');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored).toBeTruthy();
    expect(Array.isArray(stored)).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('My Test Config');
    await snap(page, testInfo, 'config-saved');
  });

  test('save config with empty name shows error', async ({ page }: { page: Page }, testInfo) => {
    allowWarnings(testInfo, 'Expected error toast for empty config name.');
    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openSaveDialog(page);
    await snap(page, testInfo, 'save-dialog-open');

    await page.getByRole('dialog').getByRole('button', { name: /save|confirm/i }).click();
    await snap(page, testInfo, 'save-attempted');

    await expect(page.getByText(/Name required|Enter a config name/i).first()).toBeVisible();
    await snap(page, testInfo, 'error-shown');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored?.configs || []).toHaveLength(0);
    await snap(page, testInfo, 'not-saved');
  });

  test('save config with duplicate name shows error', async ({ page }: { page: Page }, testInfo) => {
    allowWarnings(testInfo, 'Expected error toast for duplicate config name.');
    
    await page.addInitScript(({ baseUrl }) => {
      localStorage.setItem('c64u_app_configs', JSON.stringify([{
        id: 'existing-id',
        name: 'Existing Config',
        baseUrl: baseUrl,
        savedAt: new Date().toISOString(),
        data: {},
      }]));
    }, { baseUrl: server.baseUrl });

    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openSaveDialog(page);
    await snap(page, testInfo, 'save-dialog-open');

    const nameInput = page.getByRole('dialog').getByRole('textbox', { name: /name|config name/i });
    await nameInput.fill('Existing Config');
    await snap(page, testInfo, 'duplicate-name-entered');

    await page.getByRole('dialog').getByRole('button', { name: /save|confirm/i }).click();
    await snap(page, testInfo, 'save-attempted');

    await expect(page.getByText(/Name already used|Choose a unique|already exists/i).first()).toBeVisible();
    await snap(page, testInfo, 'error-shown');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored).toHaveLength(1);
    await snap(page, testInfo, 'not-duplicated');
  });

  test('load config applies values to server', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(({ baseUrl }) => {
      localStorage.setItem('c64u_app_configs', JSON.stringify([{
        id: 'test-config-id',
        name: 'Test Load Config',
        baseUrl: baseUrl,
        savedAt: new Date().toISOString(),
        data: {
          'U64 Specific Settings': {
            items: {
              'System Mode': { selected: 'PAL' },
              'HDMI Scan lines': { selected: 'Enabled' },
            },
          },
        },
      }]));
    }, { baseUrl: server.baseUrl });

    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openLoadDialog(page);
    await snap(page, testInfo, 'load-dialog-open');

    await page.getByRole('dialog').getByText('Test Load Config').click();
    await snap(page, testInfo, 'config-selected');

    await expect(page.getByText(/Config loaded|Loaded/i).first()).toBeVisible();
    await snap(page, testInfo, 'toast-shown');

    await expect.poll(() => 
      server.requests.some(req => req.url.includes('/v1/configs') && req.method === 'POST')
    ).toBe(true);

    await snap(page, testInfo, 'config-applied');
  });

  test('rename config updates localStorage', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(({ baseUrl }) => {
      localStorage.setItem('c64u_app_configs', JSON.stringify([{
        id: 'rename-config-id',
        name: 'Old Name',
        baseUrl: baseUrl,
        savedAt: new Date().toISOString(),
        data: {},
      }]));
    }, { baseUrl: server.baseUrl });

    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openManageDialog(page);
    await snap(page, testInfo, 'manage-dialog-open');

    // In the manage dialog, there's an input with the current name
    const renameInput = page.getByRole('dialog').getByRole('textbox');
    await expect(renameInput).toHaveValue('Old Name');
    await snap(page, testInfo, 'input-visible');

    await renameInput.clear();
    await renameInput.fill('New Name');
    await snap(page, testInfo, 'new-name-entered');

    // Click the "Rename" button in the config card
    await page.getByRole('dialog').getByRole('button', { name: /rename/i }).click();
    await snap(page, testInfo, 'rename-clicked');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('New Name');
    await snap(page, testInfo, 'config-renamed');
  });

  test('delete config removes from localStorage', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(({ baseUrl }) => {
      localStorage.setItem('c64u_app_configs', JSON.stringify([{
        id: 'delete-config-id',
        name: 'Config to Delete',
        baseUrl: baseUrl,
        savedAt: new Date().toISOString(),
        data: {},
      }]));
    }, { baseUrl: server.baseUrl });

    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openManageDialog(page);
    await snap(page, testInfo, 'manage-dialog-open');

    // Click the "Delete" button directly (no confirmation dialog)
    await page.getByRole('dialog').getByRole('button', { name: /delete/i }).click();
    await snap(page, testInfo, 'delete-clicked');

    // Wait for the dialog to still be open but config list to be empty
    await expect(page.getByRole('dialog').getByText(/No saved configurations/i)).toBeVisible();
    await snap(page, testInfo, 'config-deleted-ui');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored || []).toHaveLength(0);
    await snap(page, testInfo, 'config-deleted');
  });
});
