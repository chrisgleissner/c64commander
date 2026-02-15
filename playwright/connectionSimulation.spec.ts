/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  try {
    await attachStepScreenshot(page, testInfo, label);
  } catch (error) {
    console.warn(`Step screenshot failed for "${label}"`, error);
  }
};

const clickWithoutNavigationWait = async (page: Page, locator: Locator, attempts = 3) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await locator.click({ timeout: 10000, noWaitAfter: true });
      return;
    } catch (error) {
      if (attempt >= attempts - 1) {
        const handle = await locator.elementHandle().catch(() => null);
        if (handle) {
          try {
            await page.evaluate((node) => (node as HTMLElement).click(), handle);
            return;
          } catch {
            // Fall through and throw the original click error.
          }
        }
        throw error;
      }
      await page.waitForTimeout(250);
    }
  }
};

const withTimeout = async (promise: Promise<void>, label: string, timeoutMs = 60000) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    promise.then(() => false),
    new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  if (timedOut) {
    console.warn(`${label} timed out after ${timeoutMs}ms`);
  }
};

// Seed once per test; allowed base URLs cover both real and demo, so no paired call is required.
const seedRoutingExpectations = async (page: Page, realBaseUrl: string, demoBaseUrl?: string | null) => {
  await page.addInitScript(({ realBaseUrl: realArg, demoBaseUrl: demoArg }: { realBaseUrl: string; demoBaseUrl: string | null }) => {
    (window as Window & { __c64uExpectedBaseUrl?: string; __c64uTestProbeEnabled?: boolean }).__c64uExpectedBaseUrl = realArg;
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
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
      if (!page.isClosed()) {
        await withTimeout(finalizeEvidence(page, testInfo), 'finalizeEvidence');
      }
      await demoServer?.close?.().catch((error) => {
        console.warn('Failed to close demo mock server', error);
      });
      demoServer = null;
      await server?.close?.().catch((error) => {
        console.warn('Failed to close primary mock server', error);
      });
    }
  });

  test('real device unreachable → enable demo → app remains usable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server({});
    demoServer = await createMockC64Server({});
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
      if (!sessionStorage.getItem('c64u_demo_interstitial_reset_once')) {
        sessionStorage.removeItem('c64u_demo_interstitial_shown');
        sessionStorage.setItem('c64u_demo_interstitial_reset_once', '1');
      }
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog', { name: 'Demo Mode' });
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    }

    const demoIndicator = page.getByTestId('connectivity-indicator');
    await expect(demoIndicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE', { timeout: 10000 });

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
      if (!sessionStorage.getItem('c64u_demo_interstitial_reset_once')) {
        sessionStorage.removeItem('c64u_demo_interstitial_shown');
        sessionStorage.setItem('c64u_demo_interstitial_reset_once', '1');
      }
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });
    await expect(page.getByRole('dialog', { name: 'Demo Mode' })).toHaveCount(0);
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
      localStorage.setItem('c64u_startup_discovery_window_ms', '500');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      if (!sessionStorage.getItem('c64u_demo_interstitial_reset_once')) {
        sessionStorage.removeItem('c64u_demo_interstitial_shown');
        sessionStorage.setItem('c64u_demo_interstitial_reset_once', '1');
      }
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
    }, { host, demoBaseUrl: demoServer.baseUrl });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dialogTitle = page.getByRole('dialog', { name: 'Demo Mode' });
    await expect(dialogTitle).toBeVisible({ timeout: 30000 });
    await dialogTitle.getByRole('button', { name: 'Continue in Demo Mode' }).click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('dialog', { name: 'Demo Mode' })).toHaveCount(0);

    await snap(page, testInfo, 'demo-fallback-once');
  });

  test('demo enabled → real device reachable (informational only)', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    test.slow();
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
      const payload = {
        items: [
          { source: 'ultimate', path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 60000 },
        ],
        currentIndex: -1,
      };
      const serialized = JSON.stringify(payload);
      localStorage.setItem('c64u_playlist:v1:TEST-123', serialized);
      localStorage.setItem('c64u_playlist:v1:default', serialized);
      localStorage.setItem('c64u_last_device_id', 'TEST-123');
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
    const saveButton = page.getByRole('button', { name: /Save & Connect|Save connection/i });
    await expect(saveButton).toBeVisible({ timeout: 15000 });
    await clickWithoutNavigationWait(page, saveButton);

    const realIndicator = page.getByTestId('connectivity-indicator');
    let connected = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await expect(realIndicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 12000 });
        connected = true;
        break;
      } catch {
        await clickWithoutNavigationWait(page, realIndicator);
      }
    }
    if (!connected) {
      await expect(realIndicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 30000 });
    }

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => server.requests.some((req) => req.url.startsWith('/v1/drives'))).toBe(true);

    const { related } = await expectRestTraceSequence(page, testInfo, '/v1/drives');
    const decisionEvent = related.find((event) => event.type === 'backend-decision');
    expect((decisionEvent?.data as { selectedTarget?: string }).selectedTarget).toBe('external-mock');

    await snap(page, testInfo, 'real-connected-operations');
  });

  test('connection mode switch preserves playlist state', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const dismissDemoInterstitialIfPresent = async () => {
      const demoContinue = page.getByRole('button', { name: /continue in demo mode/i });
      const demoDialog = page.getByRole('dialog', { name: /demo mode/i });

      try {
        await demoDialog.waitFor({ state: 'visible', timeout: 1500 });
      } catch {
        // Dialog may not appear if discovery converges quickly.
      }

      if (await demoContinue.isVisible()) {
        await demoContinue.click();
        await expect(demoDialog).toBeHidden({ timeout: 5000 });
        return;
      }

      if (await demoDialog.isVisible()) {
        const continueButton = demoDialog.getByRole('button', { name: /Continue in Demo Mode|Close|Dismiss|OK/i }).first();
        if (await continueButton.isVisible()) {
          await continueButton.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await expect(demoDialog).toBeHidden({ timeout: 5000 });
      }
    };

    await dismissDemoInterstitialIfPresent();
    const saveButton = page.getByRole('button', { name: /Save & Connect|Save connection/i });
    if (!(await saveButton.isVisible())) {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await dismissDemoInterstitialIfPresent();
    }
    await expect(saveButton).toBeVisible({ timeout: 15000 });
    await clickWithoutNavigationWait(page, saveButton);
    const postSaveDemo = page.getByRole('button', { name: 'Continue in Demo Mode' });
    if (await postSaveDemo.isVisible()) {
      await postSaveDemo.click();
    }
    const postSaveDialog = page.getByRole('dialog');
    if (await postSaveDialog.isVisible()) {
      const continueButton = postSaveDialog.getByRole('button', { name: /Continue in Demo Mode|Close|Dismiss|OK/i }).first();
      if (await continueButton.isVisible()) {
        await continueButton.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(postSaveDialog).toBeHidden({ timeout: 5000 });
    }

    const indicator = page.getByTestId('connectivity-indicator');
    await expect.poll(async () => {
      const state = await indicator.getAttribute('data-connection-state');
      return state === 'DEMO_ACTIVE' || state === 'REAL_CONNECTED';
    }).toBe(true);
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

    await seedUiMocks(page, server.baseUrl);

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
      const serialized = JSON.stringify(payload);
      const playlistKeys = new Set<string>(['c64u_playlist:v1:default', 'c64u_playlist:v1:TEST-123']);
      const lastDeviceId = localStorage.getItem('c64u_last_device_id');
      if (lastDeviceId) {
        playlistKeys.add(`c64u_playlist:v1:${lastDeviceId}`);
      }
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('c64u_playlist:v1:')) {
          playlistKeys.add(key);
        }
      }
      playlistKeys.forEach((key) => localStorage.setItem(key, serialized));
      if (!lastDeviceId) {
        localStorage.setItem('c64u_last_device_id', 'TEST-123');
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');

    const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
    if (await demoRow.isVisible().catch(() => false)) {
      await demoRow.click();
    }
    const demoPlayButton = page.getByTestId('playlist-play');
    if (await demoPlayButton.isEnabled().catch(() => false)) {
      await clickWithoutNavigationWait(page, demoPlayButton);
    }
    expect(server.sidplayRequests).toHaveLength(0);

    server.setReachable(true);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    const automaticDemoToggle = page.getByLabel('Automatic Demo Mode');
    if (await automaticDemoToggle.isVisible().catch(() => false)) {
      await automaticDemoToggle.uncheck();
    }
    await clickWithoutNavigationWait(page, page.getByRole('button', { name: /Save & Connect|Save connection/i }));
    const continueDemo = page.getByRole('button', { name: /Continue in Demo Mode/i });
    if (await continueDemo.isVisible().catch(() => false)) {
      await continueDemo.click();
    }
    const realIndicator = page.getByTestId('connectivity-indicator');
    try {
      await expect.poll(
        () => realIndicator.getAttribute('data-connection-state'),
        { timeout: 7000 },
      ).toBe('REAL_CONNECTED');
    } catch {
      await clickWithoutNavigationWait(page, realIndicator);
      await expect.poll(
        () => realIndicator.getAttribute('data-connection-state'),
        { timeout: 15000 },
      ).toBe('REAL_CONNECTED');
    }

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
        await clickWithoutNavigationWait(page, playButtonAfter);
        await expect(playButtonAfter).toHaveAttribute('aria-label', 'Play');
      }
      await clickWithoutNavigationWait(page, playButtonAfter);
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
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 15000 });

    server.setReachable(false);
    await clickWithoutNavigationWait(page, indicator);
    const dialog = page.getByRole('dialog', { name: 'Demo Mode' });
    await dialog.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
    const dialogVisible = await dialog.isVisible().catch(() => false);
    if (dialogVisible) {
      await dialog.getByRole('button', { name: 'Continue in Demo Mode' }).click();
    }
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
    await expect(indicator).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Currently using: ${demoHost}`)).toBeVisible();
    await expect.poll(() => demoServer?.requests.some((req) => req.url.startsWith('/v1/info'))).toBe(true);

    server.setReachable(true);

    // Allow mock server state to propagate before triggering rediscovery.
    await page.waitForTimeout(500);

    // Trigger a single manual discovery probe. The demo interstitial was already
    // dismissed earlier in this test, so clicking the indicator just runs probeOnce().
    await clickWithoutNavigationWait(page, indicator);
    try {
      await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 15000 });
    } catch {
      // First attempt may race with state changes — retry once.
      await clickWithoutNavigationWait(page, indicator);
      await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 15000 });
    }
    const currentUsing = page.getByText('Currently using:');
    await expect(currentUsing).toBeVisible();
    await expect.poll(
      async () => (await currentUsing.locator('span').textContent())?.trim() ?? '',
      { timeout: 30000 },
    ).toBe(host);

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
    await clickWithoutNavigationWait(page, page.getByRole('button', { name: /Save & Connect|Save connection/i }));
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 10000 });
    const currentUsing = page.getByText('Currently using:');
    await expect(currentUsing).toBeVisible();
    await expect(currentUsing.locator('span')).toHaveText(/127\.0\.0\.1:\d+/);
    await expect(page.getByText('(Demo mock)', { exact: false })).toHaveCount(0);
    await snap(page, testInfo, 'currently-using-updated');
  });
});
