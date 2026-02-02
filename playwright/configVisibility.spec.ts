import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { uiFixtures } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence } from './traceUtils';
import { saveCoverageFromPage } from './withCoverage';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Config visibility across modes', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let demoServer: Awaited<ReturnType<typeof createMockC64Server>>;

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await demoServer?.close?.().catch(() => {});
      await server?.close?.().catch(() => {});
    }
  });

  test('config categories and values render in demo mode', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server(uiFixtures.configState);
    demoServer = await createMockC64Server(uiFixtures.configState);
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({
      host: hostArg,
      demoBaseUrl,
      serverBaseUrl,
      snapshot,
    }: {
      host: string;
      demoBaseUrl: string;
      serverBaseUrl: string;
      snapshot: unknown;
    }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '300');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
      localStorage.setItem(`c64u_initial_snapshot:${serverBaseUrl}`, JSON.stringify(snapshot));
      sessionStorage.setItem(`c64u_initial_snapshot_session:${serverBaseUrl}`, '1');
      localStorage.setItem(`c64u_initial_snapshot:${demoBaseUrl}`, JSON.stringify(snapshot));
      sessionStorage.setItem(`c64u_initial_snapshot_session:${demoBaseUrl}`, '1');
      sessionStorage.setItem('c64u_demo_interstitial_shown', '1');
    }, {
      host,
      demoBaseUrl: demoServer.baseUrl,
      serverBaseUrl: server.baseUrl,
      snapshot: uiFixtures.initialSnapshot,
    });

    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    const demoButton = page.getByRole('button', { name: 'Continue in Demo Mode' });
    if (await demoButton.isVisible().catch(() => false)) {
      await demoButton.click();
    }
    await expect(page.getByRole('dialog', { name: 'Demo Mode' })).toBeHidden();
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute('data-connection-state', /DEMO_ACTIVE|REAL_CONNECTED/, { timeout: 10000 });

    await expect(page.getByRole('button', { name: 'U64 Specific Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();

    await clearTraces(page);

    const selectTrigger = page.getByLabel('System Mode select');
    await selectTrigger.click();
    await page.getByRole('option', { name: /^NTSC$/ }).click();

    const checkbox = page.getByLabel('HDMI Scan lines checkbox');
    await checkbox.click();

    const configItemBase = '/v1/configs/U64%20Specific%20Settings';
    const { requestEvent } = await expectRestTraceSequence(
      page,
      testInfo,
      new RegExp(`${configItemBase}/(System%20Mode|HDMI%20Scan%20lines)`),
    );
    expect((requestEvent.data as { target?: string }).target).toBe('internal-mock');

    await expect.poll(() => demoServer.getState()['U64 Specific Settings']['System Mode'].value).toBe('NTSC');
    await expect.poll(() => demoServer.getState()['U64 Specific Settings']['HDMI Scan lines'].value).toBe('Disabled');
    await snap(page, testInfo, 'demo-config-values');
  });

  test('config remains visible after switching demo → real', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    allowWarnings(testInfo, 'Expected probe failures during offline discovery.');

    server = await createMockC64Server(uiFixtures.configState);
    demoServer = await createMockC64Server(uiFixtures.configState);
    server.setReachable(false);

    const host = new URL(server.baseUrl).host;
    await page.addInitScript(({
      host: hostArg,
      demoBaseUrl,
      serverBaseUrl,
      snapshot,
    }: {
      host: string;
      demoBaseUrl: string;
      serverBaseUrl: string;
      snapshot: unknown;
    }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '300');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', hostArg);
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
      localStorage.setItem(`c64u_initial_snapshot:${serverBaseUrl}`, JSON.stringify(snapshot));
      sessionStorage.setItem(`c64u_initial_snapshot_session:${serverBaseUrl}`, '1');
      localStorage.setItem(`c64u_initial_snapshot:${demoBaseUrl}`, JSON.stringify(snapshot));
      sessionStorage.setItem(`c64u_initial_snapshot_session:${demoBaseUrl}`, '1');
      sessionStorage.setItem('c64u_demo_interstitial_shown', '1');
    }, {
      host,
      demoBaseUrl: demoServer.baseUrl,
      serverBaseUrl: server.baseUrl,
      snapshot: uiFixtures.initialSnapshot,
    });

    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    const demoButton = page.getByRole('button', { name: 'Continue in Demo Mode' });
    if (await demoButton.isVisible().catch(() => false)) {
      await demoButton.click();
    }
    await expect(page.getByRole('dialog', { name: 'Demo Mode' })).toBeHidden();
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute('data-connection-state', /DEMO_ACTIVE|REAL_CONNECTED/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Audio Mixer' })).toBeVisible();

    server.setReachable(true);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();

    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Audio Mixer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'U64 Specific Settings' })).toBeVisible();
    await snap(page, testInfo, 'config-visible-after-real');
  });
});
