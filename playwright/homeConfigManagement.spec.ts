import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring, allowWarnings } from './testArtifacts';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from './traceUtils';
import { layoutTest, enforceDeviceTestMapping } from './layoutTest';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const openSaveDialog = async (page: Page) => {
  // Click the "Save to App" QuickActionCard (label="Save", description="To App")
  const button = page.getByTestId('home-config-save-app');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const openLoadDialog = async (page: Page) => {
  // Click the "Load from App" QuickActionCard (label="Load", description="From App")
  // There are two "Load" cards, we want the second one (first is "From flash", second is "From App")
  const button = page.getByTestId('home-config-load-app');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const openManageDialog = async (page: Page) => {
  // Click the "Manage" QuickActionCard (label="Manage", description="App Configs")
  // Need to wait for it to be enabled (requires appConfigs.length > 0)
  const button = page.getByTestId('home-config-manage-app');
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

test.describe('Home page app config management', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enforceDeviceTestMapping(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.removeItem('c64u_app_configs');
    });
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

  layoutTest('save config with valid name stores in localStorage @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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

  test('save config with empty name shows error @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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

  test('save config with duplicate name shows error @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for duplicate config name.');

    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
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

  test('load config applies values to server @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
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

    await clearTraces(page);
    await page.getByRole('dialog').getByText('Test Load Config').click();
    await snap(page, testInfo, 'config-selected');

    await expect(page.getByText(/Config loaded|Loaded/i).first()).toBeVisible();
    await snap(page, testInfo, 'toast-shown');

    await expect.poll(() =>
      server.requests.some(req => req.url.includes('/v1/configs') && req.method === 'POST')
    ).toBe(true);

    const { requestEvent } = await expectRestTraceSequence(page, testInfo, '/v1/configs');
    expect((requestEvent.data as { target?: string }).target).toBe('external-mock');

    await snap(page, testInfo, 'config-applied');
  });

  test('rename config updates localStorage @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
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

  test('delete config removes from localStorage @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
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

  test('home page renders SID status group @layout', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.request.post(`${server.baseUrl}/v1/configs`, {
      data: {
        'SID Sockets Configuration': {
          'SID Socket 1': 'Enabled',
          'SID Socket 2': 'Disabled',
        },
        'SID Addressing': {
          'UltiSID 1 Address': '',
          'UltiSID 2 Address': '$D420',
        },
      },
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'HOME' })).toBeVisible({ timeout: 20000 });
    const sidGroup = page.getByTestId('home-sid-status');
    await expect(sidGroup).toBeVisible({ timeout: 20000 });
    await expect(sidGroup.getByTestId('sid-status-label')).toContainText('SID');
    await expect(sidGroup.getByRole('button', { name: 'Reset' })).toBeVisible();
    await expect(sidGroup.locator('[data-testid="sid-status-dot"]')).toHaveCount(0);
    await expect(sidGroup).toContainText('SID Socket 1');
    await expect(sidGroup).toContainText('ON');
    await expect(sidGroup).toContainText('SID Socket 2');
    await expect(sidGroup).toContainText('UltiSID 1');
    await expect(sidGroup).toContainText('UltiSID 2');
    await expect(sidGroup).toContainText('$D400');
    await snap(page, testInfo, 'sid-status');
  });
});
