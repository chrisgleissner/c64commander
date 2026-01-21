import { test, expect, type Page, type TestInfo } from '@playwright/test';
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
  await page.getByText('App Configs').click();
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
    expect(stored.configs).toHaveLength(1);
    expect(stored.configs[0].name).toBe('My Test Config');
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
    
    await page.addInitScript(() => {
      localStorage.setItem('c64u_app_configs', JSON.stringify({
        configs: [{
          id: 'existing-id',
          name: 'Existing Config',
          snapshot: {},
          createdAt: new Date().toISOString(),
        }],
      }));
    });

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

    expect(stored.configs).toHaveLength(1);
    await snap(page, testInfo, 'not-duplicated');
  });

  test('load config applies values to server', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_app_configs', JSON.stringify({
        configs: [{
          id: 'test-config-id',
          name: 'Test Load Config',
          snapshot: {
            'U64 Specific Settings': {
              'System Mode': { value: 'PAL' },
              'HDMI Scan lines': { value: 'Enabled' },
            },
          },
          createdAt: new Date().toISOString(),
        }],
      }));
    });

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
    await page.addInitScript(() => {
      localStorage.setItem('c64u_app_configs', JSON.stringify({
        configs: [{
          id: 'rename-config-id',
          name: 'Old Name',
          snapshot: {},
          createdAt: new Date().toISOString(),
        }],
      }));
    });

    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openManageDialog(page);
    await snap(page, testInfo, 'manage-dialog-open');

    await page.getByRole('dialog').getByRole('button', { name: /rename|edit name/i }).first().click();
    await snap(page, testInfo, 'rename-initiated');

    const renameInput = page.getByRole('dialog').getByRole('textbox').filter({ hasText: /old name/i }).or(
      page.getByRole('dialog').locator('input[value="Old Name"]')
    ).first();
    
    await renameInput.fill('New Name');
    await snap(page, testInfo, 'new-name-entered');

    const saveButton = page.getByRole('dialog').getByRole('button', { name: /save|confirm/i }).first();
    await saveButton.click();
    await snap(page, testInfo, 'rename-saved');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored.configs).toHaveLength(1);
    expect(stored.configs[0].name).toBe('New Name');
    await snap(page, testInfo, 'config-renamed');
  });

  test('delete config removes from localStorage', async ({ page }: { page: Page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_app_configs', JSON.stringify({
        configs: [{
          id: 'delete-config-id',
          name: 'Config to Delete',
          snapshot: {},
          createdAt: new Date().toISOString(),
        }],
      }));
    });

    await page.goto('/');
    await snap(page, testInfo, 'home-open');

    await openManageDialog(page);
    await snap(page, testInfo, 'manage-dialog-open');

    await page.getByRole('dialog').getByRole('button', { name: /delete|remove/i }).first().click();
    await snap(page, testInfo, 'delete-initiated');

    const confirmButton = page.getByRole('button', { name: /delete|confirm|yes/i }).last();
    await confirmButton.click();
    await snap(page, testInfo, 'delete-confirmed');

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : null;
    });

    expect(stored?.configs || []).toHaveLength(0);
    await snap(page, testInfo, 'config-deleted');
  });
});
