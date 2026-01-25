import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
// Load full YAML config for tests
import '../tests/mocks/setupMockConfigForTests';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { allowVisualOverflow, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

test.describe('App screenshots', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeAll(async () => {
    // Use default YAML config (no initial state) to show all categories
    server = await createMockC64Server();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem('c64u_feature_flag:hvsc_enabled', '1');
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
    }
  });

  const waitForStableRender = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => (document as any).fonts?.ready ?? true);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };

  const waitForOverlaysToClear = async (page: Page) => {
    const notificationRegion = page.locator('[aria-label="Notifications (F8)"]');
    const openToasts = notificationRegion.locator('[data-state="open"], [role="status"]');
    await expect(openToasts).toHaveCount(0, { timeout: 10000 });
  };

  test('capture app page screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, 'Audio mixer controls overflow on narrow screenshot viewport.');
    const screenshotPath = (fileName: string) => path.resolve('doc/img', fileName);

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Disks', exact: true })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-home.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'home-light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-home-dark.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'home-dark');
    await page.emulateMedia({ colorScheme: 'light' });

    await page.getByRole('button', { name: 'Disks', exact: true }).click();
    await expect(page.locator('header').getByRole('heading', { name: 'Disks' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-disks.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'disks');

    await page.getByRole('button', { name: 'Config', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-configuration.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'configuration');

    const u64Card = page.getByRole('button', { name: 'U64 Specific Settings', exact: true });
    if (await u64Card.isVisible()) {
      await u64Card.click();
      await expect(page.getByText('System Mode')).toBeVisible();
      await waitForStableRender(page);
      await waitForOverlaysToClear(page);
      await page.screenshot({ path: screenshotPath('app-configuration-u64-specific.png'), animations: 'disabled', caret: 'hide' });
      await attachStepScreenshot(page, testInfo, 'configuration-u64');
    }

    await page.getByRole('button', { name: 'Audio Mixer', exact: true }).click();
    const slider = page.getByLabel('Vol UltiSid 1 slider');
    await expect(slider).toBeVisible();
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width - 2, y: sliderBox.height / 2 } });
    }
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-configuration-expanded.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'configuration-audio-mixer');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await expect(page.getByText('HVSC library')).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-play.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'play');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-settings.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'settings');

    await page.getByRole('button', { name: 'Docs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-documentation.png'), animations: 'disabled', caret: 'hide' });
    await attachStepScreenshot(page, testInfo, 'docs');
  });
});
