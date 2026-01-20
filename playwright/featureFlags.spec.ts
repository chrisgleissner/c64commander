import { test, expect, type Page } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';

test.describe('Feature flags', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }) => {
    server = await createMockC64Server(uiFixtures.configState);
    await page.addInitScript(() => {
      localStorage.removeItem('c64u_feature_flag:hvsc_enabled');
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

  test('developer mode gating hides HVSC toggle', async ({ page }: { page: Page }) => {
    await page.goto('/settings');
    await expect(page.getByLabel('Enable HVSC downloads')).toHaveCount(0);
  });

  test('developer mode shows toggle and default is off', async ({ page }: { page: Page }) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await page.goto('/play');
    await expect(page.getByText('Install HVSC')).toHaveCount(0);
  });

  test('dynamic enablement shows HVSC controls', async ({ page }: { page: Page }) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.goto('/play');
    await expect(page.getByRole('button', { name: /Install HVSC|Check updates/ })).toBeVisible();
  });

  test('dynamic disablement hides HVSC controls', async ({ page }: { page: Page }) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.goto('/play');
    await expect(page.getByRole('button', { name: 'Install HVSC' })).toHaveCount(0);
  });

  test('legacy /music route shows 404 page', async ({ page }: { page: Page }) => {
    await page.goto('/music');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText('Oops! Page not found')).toBeVisible();
  });
});
