import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

test.describe('Feature flags', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await page.addInitScript(() => {
      localStorage.removeItem('c64u_feature_flag:hvsc_enabled');
      localStorage.removeItem('c64u_dev_mode_enabled');
    });
    await seedUiMocks(page, server.baseUrl);
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

  const enableDeveloperMode = async (page: Page) => {
    await page.goto('/settings');
    const aboutButton = page.getByRole('button', { name: 'About' });
    for (let i = 0; i < 7; i += 1) {
      await aboutButton.click();
    }
  };

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  test('developer mode gating hides HVSC toggle', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/settings');
    await expect(page.getByLabel('Enable HVSC downloads')).toHaveCount(0);
    await snap(page, testInfo, 'toggle-hidden');
  });

  test('developer mode shows toggle and default is off', async ({ page }: { page: Page }, testInfo) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await snap(page, testInfo, 'toggle-off');
    await page.goto('/play');
    await expect(page.getByText('Install HVSC')).toHaveCount(0);
    await snap(page, testInfo, 'hvsc-hidden');
  });

  test('dynamic enablement shows HVSC controls', async ({ page }: { page: Page }, testInfo) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await snap(page, testInfo, 'toggle-on');
    await page.goto('/play');
    await expect(page.getByRole('button', { name: /Install HVSC|Check updates/ })).toBeVisible();
    await snap(page, testInfo, 'hvsc-visible');
  });

  test('dynamic disablement hides HVSC controls', async ({ page }: { page: Page }, testInfo) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await snap(page, testInfo, 'toggle-disabled');
    await page.goto('/play');
    await expect(page.getByRole('button', { name: 'Install HVSC' })).toHaveCount(0);
    await snap(page, testInfo, 'hvsc-hidden');
  });

  test('legacy /music route shows 404 page', async ({ page }: { page: Page }, testInfo) => {
    allowWarnings(testInfo, 'Expected 404 route log output.');
    await page.goto('/music');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText('Oops! Page not found')).toBeVisible();
    await snap(page, testInfo, '404');
  });
});
