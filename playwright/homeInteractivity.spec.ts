import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const hasRequest = (
  requests: Array<{ method: string; url: string }>,
  predicate: (req: { method: string; url: string }) => boolean,
) => requests.some(predicate);

const waitForConnected = async (page: Page) => {
  await expect(page.getByTestId('connectivity-indicator')).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 10000 });
};

const waitForStreamsReady = async (page: Page) => {
  await waitForConnected(page);
  const streamPattern = /\d+\.\d+\.\d+\.\d+:\d+/;
  await expect(page.getByTestId('home-stream-endpoint-display-audio')).toHaveText(streamPattern);
  await expect(page.getByTestId('home-stream-endpoint-display-vic')).toHaveText(streamPattern);
};

test.describe('Home interactions', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server();
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

  test('start/stop interactions send stream commands', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForStreamsReady(page);

    await page.getByTestId('home-stream-start-audio').click();

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/streams/audio:start'),
      ),
    ).toBe(true);

    await page.getByTestId('home-stream-stop-audio').click();

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/streams/audio:stop'),
      ),
    ).toBe(true);
  });

  test('dropdown interactions update drive and SID config', async ({ page }: { page: Page }) => {
    await page.request.post(`${server.baseUrl}/v1/configs`, {
      data: {
        'SID Sockets Configuration': {
          'SID Socket 1': 'Enabled',
        },
        'SID Addressing': {
          'SID Socket 1 Address': '$D400',
        },
        'Audio Mixer': {
          'Pan Socket 1': 'Left 5',
        },
      },
    });

    await page.goto('/');
    await waitForConnected(page);

    await page.getByTestId('home-drive-type-a').click();
    await page.getByRole('option', { name: '1571' }).click();

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/configs/Drive%20A%20Settings/Drive%20Type?value=1571'),
      ),
    ).toBe(true);

    const sidToggle = page.getByTestId('home-sid-toggle-socket1');
    await expect(sidToggle).toBeVisible();
    await sidToggle.click();

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/configs/SID%20Sockets%20Configuration/SID%20Socket%201?value=Disabled'),
      ),
    ).toBe(true);
  });

  test('input interactions validate and then update stream config', async ({ page }: { page: Page }) => {
    allowWarnings(test.info(), 'Expected validation toast for invalid stream host input.');
    await page.goto('/');
    await waitForStreamsReady(page);

    await page.getByTestId('home-stream-edit-toggle-vic').click();
    const input = page.getByTestId('home-stream-endpoint-vic');
    await input.fill('bad host!:11000');
    await page.getByTestId('home-stream-confirm-vic').click();

    await page.waitForTimeout(150);
    expect(hasRequest(server.requests, (req) => req.url.includes('bad%20host%21%3A11000'))).toBe(false);

    await input.fill('239.0.1.90:11000');
    await page.getByTestId('home-stream-confirm-vic').click();

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/configs/Data%20Streams/Stream%20VIC%20to?value=239.0.1.90%3A11000'),
      ),
    ).toBe(true);
  });

  test('home reset drives calls all disk reset endpoints only', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForConnected(page);

    await page.getByTestId('home-drives-reset').click();

    await expect.poll(() =>
      hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/a:reset')),
    ).toBe(true);
    await expect.poll(() =>
      hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/b:reset')),
    ).toBe(true);
    await expect.poll(() =>
      hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/softiec:reset')),
    ).toBe(true);
    expect(hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/printer:reset'))).toBe(false);

    await expect(page.getByTestId('home-drives-group')).toBeVisible();
    await expect(page.getByTestId('home-drive-toggle-a')).toBeVisible();
  });

  test('disks per-drive reset controls call all drive reset endpoints without list regressions', async ({ page }: { page: Page }) => {
    await page.goto('/disks');
    await expect(page.getByTestId('disk-list')).toBeVisible();
    await waitForConnected(page);

    await page.getByTestId('drive-reset-a').click();
    await page.getByTestId('drive-reset-b').click();
    await page.getByTestId('drive-reset-soft-iec').click();

    await expect.poll(() =>
      hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/a:reset')),
    ).toBe(true);
    await expect.poll(() =>
      hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/b:reset')),
    ).toBe(true);
    await expect.poll(() =>
      hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/softiec:reset')),
    ).toBe(true);
    expect(hasRequest(server.requests, (req) => req.method === 'PUT' && req.url.startsWith('/v1/drives/printer:reset'))).toBe(false);

    await expect(page.getByTestId('disk-list')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add disks|Add more disks/i })).toBeVisible();
  });

  test('SID reset writes deterministic silence register set', async ({ page }: { page: Page }) => {
    await page.request.post(`${server.baseUrl}/v1/configs`, {
      data: {
        'SID Addressing': {
          'SID Socket 1 Address': '$D400',
          'SID Socket 2 Address': 'Unmapped',
          'UltiSID 1 Address': '$D420',
          'UltiSID 2 Address': 'Unmapped',
        },
      },
    });

    await page.goto('/');
    await waitForConnected(page);
    await expect(page.getByTestId('home-sid-address-socket1')).toHaveText(/\$[0-9A-F]{4}|\$----/);
    await page.getByTestId('home-sid-status').getByRole('button', { name: 'Reset' }).click();

    await expect.poll(() =>
      server.requests.filter((req) => req.method === 'PUT' && req.url.startsWith('/v1/machine:writemem')).length,
    ).toBe(20);

    const addresses = server.requests
      .filter((req) => req.method === 'PUT' && req.url.startsWith('/v1/machine:writemem'))
      .map((req) => new URL(req.url, 'http://127.0.0.1').searchParams.get('address'));

    expect(addresses).toContain('D404');
    expect(addresses).toContain('D40B');
    expect(addresses).toContain('D412');
    expect(addresses).toContain('D418');
    expect(addresses).toContain('D424');
    expect(addresses).toContain('D42B');
    expect(addresses).toContain('D432');
    expect(addresses).toContain('D438');

    await expect(page.getByTestId('home-sid-entry-socket1')).toContainText('Vol');
    await expect(page.getByTestId('home-sid-entry-ultiSid1')).toContainText('Pan');
  });

  test('SID type column renders and LED controls stay inline', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForConnected(page);

    const socketType = page.getByTestId('home-sid-type-socket1');
    await expect(socketType).toBeVisible();
    const socketTag = await socketType.evaluate((el) => el.tagName);
    expect(socketTag).toBe('SPAN');

    const ultiType = page.getByTestId('home-sid-type-ultiSid1');
    await expect(ultiType).toBeVisible();
    const ultiTag = await ultiType.evaluate((el) => el.tagName);
    expect(ultiTag).toBe('BUTTON');

    const ledControls = [
      'home-led-mode',
      'home-led-color',
      'home-led-intensity',
      'home-led-sid-select',
      'home-led-tint',
    ];

    for (const control of ledControls) {
      await expect(page.getByTestId(control)).toBeVisible();
    }

    const beforePath = await page.evaluate(() => window.location.pathname);
    await page.getByTestId('home-led-mode').click();
    await page.keyboard.press('Escape');
    const afterPath = await page.evaluate(() => window.location.pathname);
    expect(afterPath).toBe(beforePath);
  });

  test('stateless actions clear focus after click', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForConnected(page);

    const action = page.getByTestId('home-config-save-app');
    await action.scrollIntoViewIfNeeded();
    await action.click();

    const activeTestId = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active?.dataset?.testid ?? null;
    });

    expect(activeTestId).not.toBe('home-config-save-app');
  });
});
