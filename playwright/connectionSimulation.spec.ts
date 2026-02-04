import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const seedRoutingExpectations = async (page: Page, realBaseUrl: string, demoBaseUrl?: string | null) => {
  await page.addInitScript(({ realBaseUrl: realArg, demoBaseUrl: demoArg }: { realBaseUrl: string; demoBaseUrl: string | null }) => {
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = realArg;
    (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = demoArg
      ? [realArg, demoArg]
      : [realArg];
  }, { realBaseUrl, demoBaseUrl: demoBaseUrl ?? null });
};

test.describe('Deterministic Connectivity Simulation', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let demoServer: Awaited<ReturnType<typeof createMockC64Server>> | null = null;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await demoServer?.close?.().catch(() => {});
      demoServer = null;
      await server?.close?.().catch(() => {});
    }
  });

  test('real device unreachable → enable demo → app remains usable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '1500');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '1000');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    const dialogTitle = page.getByRole('heading', { name: 'Demo Mode' });
    await expect(dialogTitle).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();

    const demoIndicator = page.getByTestId('connectivity-indicator');
    await expect(demoIndicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Disk list', { exact: true })).toBeVisible();

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const nonProbeRequests = server.requests.filter((req) => !req.url.startsWith('/v1/info'));
    const disallowedRequests = nonProbeRequests.filter((req) =>
      req.url.startsWith('/v1/sidplay') || req.url.startsWith('/v1/play') || req.url.startsWith('/v1/ftp')
    );
    expect(disallowedRequests).toHaveLength(0);

    await snap(page, testInfo, 'demo-usable-navigation');
  });

  test('reachable device connects as real and never shows demo fallback', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '1500');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Demo Mode' })).toHaveCount(0);
    expect(demoServer.requests.some((req) => req.url.startsWith('/v1/info'))).toBe(false);

    await snap(page, testInfo, 'real-connected-no-demo');
  });

  test('demo fallback appears once per session', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    server.setReachable(false);
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '1000');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dialogTitle = page.getByRole('heading', { name: 'Demo Mode' });
    await expect(dialogTitle).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Demo Mode' })).toHaveCount(0);

    await snap(page, testInfo, 'demo-fallback-once');
  });

  test('demo enabled → real device reachable (informational only)', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      (window as Window & { __c64uAllowBackgroundRediscovery?: boolean }).__c64uAllowBackgroundRediscovery = true;
      localStorage.setItem('c64u_startup_discovery_window_ms', '1000');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '250');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    const demoIndicator = page.getByTestId('connectivity-indicator');
    await expect(demoIndicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');

    server.setReachable(true);
    await expect.poll(() => server.requests.some((req) => req.url.startsWith('/v1/info'))).toBe(true);
    await expect(demoIndicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');

    await snap(page, testInfo, 'demo-stays-demo');

    // Stop background rediscovery to prevent race conditions in trace completion
    await page.evaluate(() => {
      (window as Window & { __c64uAllowBackgroundRediscovery?: boolean }).__c64uAllowBackgroundRediscovery = false;
    });
    // Wait briefly for any in-flight actions to complete
    await page.waitForTimeout(100);
  });

  test('disable demo → connect to real → core operations succeed', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    server.setReachable(false);
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '400');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    server.setReachable(true);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Automatic Demo Mode').uncheck();
    await clearTraces(page);
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();

    const realIndicator = page.getByTestId('connectivity-indicator');
    await expect(realIndicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => server.requests.some((req) => req.url.startsWith('/v1/drives'))).toBe(true);

    const { related } = await expectRestTraceSequence(page, testInfo, '/v1/drives');
    const decisionEvent = related.find((event) => event.type === 'backend-decision');
    expect((decisionEvent?.data as { selectedTarget?: string }).selectedTarget).toBe('external-mock');

    await snap(page, testInfo, 'real-connected-operations');
  });

  test('switch back to demo preserves playlist state', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_startup_discovery_window_ms', '400');
      const playlistPayload = JSON.stringify({
        items: [
          { source: 'local', path: '/storage/demo.sid', name: 'demo.sid', durationMs: 60000 },
        ],
        currentIndex: -1,
      });
      localStorage.setItem('c64u_playlist:v1:TEST-123', playlistPayload);
      localStorage.setItem('c64u_playlist:v1:default', playlistPayload);
      localStorage.setItem('c64u_last_device_id', 'TEST-123');
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await seedUiMocks(page, server.baseUrl);

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();

    server.setReachable(false);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const demoContinue = page.getByRole('button', { name: 'Continue in Demo Mode' });
    if (await demoContinue.isVisible().catch(() => false)) {
      await demoContinue.click();
    }
    const demoDialog = page.getByRole('dialog');
    if (await demoDialog.isVisible().catch(() => false)) {
      const continueButton = demoDialog.getByRole('button', { name: /Continue in Demo Mode|Close|Dismiss|OK/i }).first();
      if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(demoDialog).toBeHidden({ timeout: 5000 });
    }
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click({ force: true });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();

    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('demo.sid', { exact: true })).toBeVisible();

    await snap(page, testInfo, 'playlist-preserved-demo');
  });

  test('playback routes to demo then real after switching', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '400');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');
    await page.evaluate(() => {
      const payload = {
        items: [
          { source: 'ultimate', path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 60000 },
        ],
        currentIndex: -1,
      };
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
      localStorage.setItem('c64u_playlist:v1:default', JSON.stringify(payload));
      localStorage.setItem('c64u_last_device_id', 'TEST-123');
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');

    const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
    if (await demoRow.isVisible().catch(() => false)) {
      await demoRow.click();
    }
    const demoPlayButton = page.getByTestId('playlist-play');
    if (await demoPlayButton.isEnabled().catch(() => false)) {
      await demoPlayButton.click();
    }
    expect(server.sidplayRequests).toHaveLength(0);

    server.setReachable(true);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    const realIndicator = page.getByTestId('connectivity-indicator');
    await expect(realIndicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });

    await clearTraces(page);
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    const realRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
    if (await realRow.isVisible().catch(() => false)) {
      await realRow.click();
    }
    const playButtonAfter = page.getByTestId('playlist-play');
    if (await playButtonAfter.isEnabled().catch(() => false)) {
      const label = await playButtonAfter.textContent();
      if (label && label.toLowerCase().includes('stop')) {
        await playButtonAfter.click();
        await expect(playButtonAfter).toContainText('Play');
      }
      await playButtonAfter.click();
      await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);
    }
    await snap(page, testInfo, 'demo-to-real-playback');
  });

  test('switches real → demo → real using manual discovery', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    await seedRoutingExpectations(page, server.baseUrl, demoServer.baseUrl);

    const host = new URL(server.baseUrl).host;
    const demoHost = new URL(demoServer.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '1500');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });

    server.setReachable(false);
    await indicator.click();
    const dialogTitle = page.getByRole('heading', { name: 'Demo Mode' });
    const dialogVisible = await dialogTitle.isVisible({ timeout: 5000 }).catch(() => false);
    if (dialogVisible) {
      await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    }
    await expect(indicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Currently using: ${demoHost}`)).toBeVisible();
    await expect.poll(() => demoServer?.requests.some((req) => req.url.startsWith('/v1/info'))).toBe(true);

    server.setReachable(true);
    await page.getByTestId('connectivity-indicator').click();
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });
    const currentUsing = page.getByText('Currently using:');
    await expect(currentUsing).toBeVisible();
    await expect(currentUsing.locator('span')).toHaveText(host);

    await snap(page, testInfo, 'real-demo-real-manual');
  });

  test('currently using indicator updates between demo and real', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    const demoHost = new URL(demoServer.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '300');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    await expect(page.getByText(`Currently using: ${demoHost}`)).toBeVisible();
    await expect(page.getByText('(Demo mock)', { exact: false })).toBeVisible();

    server.setReachable(true);
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 10000 });
    const currentUsing = page.getByText('Currently using:');
    await expect(currentUsing).toBeVisible();
    await expect(currentUsing.locator('span')).toHaveText(/127\.0\.0\.1:\d+/);
    await expect(page.getByText('(Demo mock)', { exact: false })).toHaveCount(0);
    await snap(page, testInfo, 'currently-using-updated');
  });
});
