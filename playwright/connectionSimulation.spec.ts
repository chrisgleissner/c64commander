import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
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
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '400');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '1000');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.setItem('c64u_password', '');
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

  test('demo enabled → real device reachable (informational only)', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '300');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '250');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.setItem('c64u_password', '');
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    const demoIndicator = page.getByTestId('connectivity-indicator');
    await expect(demoIndicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');

    server.setReachable(true);
    await expect.poll(() => server.requests.some((req) => req.url.startsWith('/v1/info'))).toBe(true);
    await expect(demoIndicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');

    await snap(page, testInfo, 'demo-stays-demo');
  });

  test('disable demo → connect to real → core operations succeed', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
      localStorage.setItem('c64u_password', '');
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    server.setReachable(true);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Automatic Demo Mode').uncheck();
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();

    const realIndicator = page.getByTestId('connectivity-indicator');
    await expect(realIndicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => server.requests.some((req) => req.url.startsWith('/v1/drives'))).toBe(true);

    await snap(page, testInfo, 'real-connected-operations');
  });

  test('switch back to demo preserves playlist state', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({ host: hostArg, demoBaseUrl }: { host: string; demoBaseUrl: string }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.setItem('c64u_password', '');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_startup_discovery_window_ms', '400');
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify({
        items: [
          { source: 'local', path: '/storage/demo.sid', name: 'demo.sid', durationMs: 60000 },
        ],
        currentIndex: -1,
      }));
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
      localStorage.setItem('c64u_password', '');
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
      localStorage.setItem('c64u_password', '');
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    await expect(page.getByText(`Currently using: ${demoHost}`)).toBeVisible();
    await expect(page.getByText('(Demo mock)', { exact: false })).toBeVisible();

    server.setReachable(true);
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    await expect(page.getByText(`Currently using: ${host}`)).toBeVisible();
    await expect(page.getByText('(Demo mock)', { exact: false })).toHaveCount(0);
    await snap(page, testInfo, 'currently-using-updated');
  });
});
