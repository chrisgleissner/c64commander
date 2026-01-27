import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

test.describe('Feature flags', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await page.addInitScript(() => {
      localStorage.removeItem('c64u_feature_flag:hvsc_enabled');
      localStorage.removeItem('c64u_dev_mode_enabled');
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

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  test('hvsc toggle is visible by default', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    const toggle = page.getByLabel('Enable HVSC downloads');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await snap(page, testInfo, 'toggle-visible');
  });

  test('hvsc toggle controls play page visibility', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    const toggle = page.getByLabel('Enable HVSC downloads');
    await expect(toggle).toBeChecked();
    await page.goto('/play');
    await expect(page.getByRole('button', { name: 'Download HVSC Library' })).toBeVisible();
    await snap(page, testInfo, 'hvsc-visible');

    await page.goto('/settings');
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.goto('/play');
    await expect(page.getByRole('button', { name: 'Download HVSC Library' })).toHaveCount(0);
    await snap(page, testInfo, 'hvsc-hidden');
  });

  test('legacy /music route shows 404 page', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected 404 route log output.');
    await page.goto('/music');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText('Oops! Page not found')).toBeVisible();
    await snap(page, testInfo, '404');
  });
});
