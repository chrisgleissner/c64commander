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

  test('toggle interactions update stream config', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await waitForStreamsReady(page);

    await page.getByTestId('home-stream-toggle-audio').click();

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/configs/Data%20Streams/Stream%20Audio%20to?value=off'),
      ),
    ).toBe(true);
  });

  test('dropdown interactions update drive and SID config', async ({ page }: { page: Page }) => {
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

    const panSlider = page.getByTestId('home-sid-pan-socket1').getByRole('slider');
    const panBox = await panSlider.boundingBox();
    if (panBox) {
      await panSlider.click({ position: { x: panBox.width * 0.85, y: panBox.height / 2 } });
    }

    await expect.poll(() =>
      hasRequest(
        server.requests,
        (req) => req.method === 'PUT' && req.url.includes('/v1/configs/Audio%20Mixer/Pan%20Socket%201?value='),
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

    await page.getByRole('button', { name: 'Reset Drives' }).click();

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

    await expect(page.getByTestId('home-sid-entry-socket1')).toContainText('Volume');
    await expect(page.getByTestId('home-sid-entry-ultiSid1')).toContainText('Pan');
  });
});
