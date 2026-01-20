import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';

test.describe('Feature flags', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }) => {
    server = await createMockC64Server(uiFixtures.configState);
    await page.addInitScript(() => {
      localStorage.removeItem('c64u_feature_flag:sid_player_enabled');
      localStorage.removeItem('c64u_dev_mode_enabled');
    });
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  const enableDeveloperMode = async (page: Page) => {
    await page.goto('/settings');
    const aboutButton = page.getByRole('button', { name: 'About' });
    for (let i = 0; i < 7; i += 1) {
      await aboutButton.click();
    }
  };

  test('developer mode gating hides SID toggle', async ({ page }: { page: Page }) => {
    await page.goto('/settings');
    await expect(page.getByLabel('Enable SID player (experimental)')).toHaveCount(0);
  });

  test('developer mode shows toggle and default is off', async ({ page }: { page: Page }) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable SID player (experimental)');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'SID', exact: true })).toHaveCount(0);
  });

  test('dynamic enablement shows SID tab', async ({ page }: { page: Page }) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable SID player (experimental)');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByRole('button', { name: 'SID', exact: true })).toBeVisible();
  });

  test('dynamic disablement hides SID tab', async ({ page }: { page: Page }) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable SID player (experimental)');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'SID', exact: true })).toHaveCount(0);
  });

  test('route safety logs when SID disabled', async ({ page }: { page: Page }) => {
    const messages: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'warning') {
        messages.push(msg.text());
      }
    });

    await page.goto('/music');
    await expect(page.getByText('Oops! Page not found')).toBeVisible();

    await expect.poll(() => messages.some((msg) => msg.includes('SID player blocked'))).toBe(true);
    const logs = await page.evaluate(() => localStorage.getItem('c64u_app_logs'));
    expect(logs).toContain('SID player blocked');
  });
});
