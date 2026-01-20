import { test, expect, type Page } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';

test.describe('App screenshots', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeAll(async () => {
    server = await createMockC64Server(uiFixtures.configState);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }: { page: Page }) => {
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(() => {
      localStorage.setItem('c64u_feature_flag:sid_player_enabled', '1');
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  const waitForStableRender = async (page: Page) => {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => (document as any).fonts?.ready ?? true);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.waitForTimeout(200);
  };

  const waitForOverlaysToClear = async (page: Page) => {
    const notificationRegion = page.locator('[aria-label="Notifications (F8)"]');
    const openToasts = notificationRegion.locator('[data-state="open"], [role="status"]');
    await expect(openToasts).toHaveCount(0, { timeout: 10000 });
  };

  test('capture app page screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }) => {
    const screenshotPath = (fileName: string) => path.resolve('doc/img', fileName);

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Quick', exact: true })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-home.png'), animations: 'disabled', caret: 'hide' });

    await page.getByRole('button', { name: 'Quick', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Quick Settings' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-quick-settings.png'), animations: 'disabled', caret: 'hide' });

    const u64Card = page.getByRole('button', { name: 'Video (VIC)', exact: true });
    if (await u64Card.isVisible()) {
      await u64Card.click();
      await expect(page.getByText('System Mode')).toBeVisible();
      await waitForStableRender(page);
      await waitForOverlaysToClear(page);
      await page.screenshot({ path: screenshotPath('app-configuration-u64-specific.png'), animations: 'disabled', caret: 'hide' });
    }

    await page.getByRole('button', { name: 'Config', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-configuration.png'), animations: 'disabled', caret: 'hide' });

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

    await page.getByRole('button', { name: 'SID', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'HVSC Library' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-music.png'), animations: 'disabled', caret: 'hide' });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-settings.png'), animations: 'disabled', caret: 'hide' });

    await page.getByRole('button', { name: 'Docs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible();
    await waitForStableRender(page);
    await waitForOverlaysToClear(page);
    await page.screenshot({ path: screenshotPath('app-documentation.png'), animations: 'disabled', caret: 'hide' });
  });
});
