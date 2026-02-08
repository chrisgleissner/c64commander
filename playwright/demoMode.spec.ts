import { test, expect } from '@playwright/test';
import type { Page, Route, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';
import { saveCoverageFromPage } from './withCoverage';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const seedRoutingExpectations = async (page: Page, realBaseUrl: string) => {
  await page.addInitScript(({ realBaseUrl: realArg }: { realBaseUrl: string }) => {
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = realArg;
    (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = [realArg];
  }, { realBaseUrl });
};

test.describe('Automatic Demo Mode', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server?.close?.().catch(() => { });
    }
  });

  test('connectivity indicator is present on all main pages', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
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
    enableGoldenTrace(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED');

    const icon = indicator.locator('svg').first();
    await expect(icon).toHaveClass(/text-success/);
    await snap(page, testInfo, 'real-connected-indicator');
  });

  test('legacy base URL migrates to device host on startup', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
      localStorage.setItem('c64u_base_url', baseUrl);
      localStorage.removeItem('c64u_device_host');
    }, { baseUrl: server.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });

    const storedHost = await page.evaluate(() => localStorage.getItem('c64u_device_host'));
    expect(storedHost).toBe(new URL(server.baseUrl).host);
    const legacyBase = await page.evaluate(() => localStorage.getItem('c64u_base_url'));
    expect(legacyBase).toBeNull();

    await snap(page, testInfo, 'legacy-base-url-migrated');
  });

  test('demo interstitial appears once per session and manual retry uses discovery', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');
    server = await createMockC64Server({});

    await page.addInitScript(() => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = 'http://127.0.0.1:1';
      (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = ['http://127.0.0.1:1'];
      localStorage.setItem('c64u_startup_discovery_window_ms', '600');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '5000');
      localStorage.setItem('c64u_device_host', '127.0.0.1:1');
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      sessionStorage.removeItem('c64u_demo_interstitial_shown');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Demo Mode' });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await snap(page, testInfo, 'demo-interstitial-shown');

    await dialog.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    await expect(dialog).toHaveCount(0);

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
    await seedRoutingExpectations(page, server.baseUrl);
    await seedUiMocks(page, server.baseUrl);

    const seenPasswords: string[] = [];
    await page.route('**/v1/info', async (route: Route) => {
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

  test('demo mode does not overwrite stored base URL', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    await page.addInitScript(() => {
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = 'http://192.168.1.13';
      (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = ['http://192.168.1.13'];
      localStorage.setItem('c64u_startup_discovery_window_ms', '400');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', '192.168.1.13');
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog', { name: 'Demo Mode' });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: 'Continue in Demo Mode' }).click();

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const urlInput = page.locator('#deviceHost');
    await expect(urlInput).toHaveValue('192.168.1.13');

    const stored = await page.evaluate(() => localStorage.getItem('c64u_base_url'));
    expect(stored).toBeNull();
    await snap(page, testInfo, 'demo-base-url-preserved');
  });

  test('save & connect exits demo mode when base URL is valid', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');
    server = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl);

    await page.addInitScript(() => {
      localStorage.setItem('c64u_startup_discovery_window_ms', '3000');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', '127.0.0.1:1');
      sessionStorage.removeItem('c64u_demo_interstitial_shown');
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const urlInput = page.locator('#deviceHost');
    const host = new URL(server.baseUrl).host;
    await urlInput.fill(host);
    await clearTraces(page);
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();

    const indicator = page.getByTestId('connectivity-indicator');
    await expect.poll(() => server.requests.some((req) => req.url.startsWith('/v1/info'))).toBe(true);
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 15000 });
    const stored = await page.evaluate(() => localStorage.getItem('c64u_device_host'));
    expect(stored).toBe(new URL(server.baseUrl).host);
    await expectRestTraceSequence(page, testInfo, '/v1/info');
    await snap(page, testInfo, 'demo-exit-connected');
  });
});

