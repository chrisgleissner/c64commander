import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Automatic Demo Mode', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server?.close?.().catch(() => {});
    }
  });

  test('connectivity indicator is present on all main pages', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);

    const routes = ['/', '/play', '/disks', '/config', '/settings', '/docs'];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const indicator = page.getByTestId('connectivity-indicator');
      await expect(indicator).toBeVisible();
      await expect(indicator).toHaveAttribute('data-connection-state', /REAL_CONNECTED|DISCOVERING|UNKNOWN|DEMO_ACTIVE|OFFLINE_NO_DEMO/);
    }

    await snap(page, testInfo, 'indicator-on-all-pages');
  });

  test('real connection shows green C64U indicator', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED');

    const icon = indicator.locator('svg').first();
    await expect(icon).toHaveClass(/text-success/);
    await snap(page, testInfo, 'real-connected-indicator');
  });

  test('demo interstitial appears once per session and manual retry uses discovery', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');
    server = await createMockC64Server({});

    await page.addInitScript(() => {
      localStorage.setItem('c64u_base_url', 'http://127.0.0.1:1');
      localStorage.setItem('c64u_startup_discovery_window_ms', '600');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '5000');
      localStorage.setItem('c64u_device_host', 'c64u');
      localStorage.setItem('c64u_password', '');
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const dialogTitle = page.getByRole('heading', { name: 'Demo Mode' });
    await expect(dialogTitle).toBeVisible({ timeout: 5000 });
    await snap(page, testInfo, 'demo-interstitial-shown');

    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    await expect(dialogTitle).toHaveCount(0);

    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');
    await expect(indicator).toContainText('DEMO');
    await snap(page, testInfo, 'demo-indicator');

    // Manual retry: should not show interstitial again in this session.
    await indicator.click();
    await expect(indicator).toHaveAttribute('data-connection-state', /DISCOVERING|DEMO_ACTIVE/);
    await expect(dialogTitle).toHaveCount(0);
    await snap(page, testInfo, 'no-repeat-interstitial');
  });

  test('settings-triggered rediscovery uses updated password for probes', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);

    const seenPasswords: string[] = [];
    await page.route('**/v1/info', async (route) => {
      const req = route.request();
      const header = req.headers()['x-password'];
      if (typeof header === 'string') {
        seenPasswords.push(header);
      }
      await route.continue();
    });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const passwordInput = page.getByLabel(/password|network password/i);
    await passwordInput.fill('new-password');
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();

    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });
    expect(seenPasswords).toContain('new-password');
    await snap(page, testInfo, 'settings-rediscovery-password');
  });
});

