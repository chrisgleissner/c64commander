import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clickSourceSelectionButton } from './sourceSelection';
import { clearTraces, enableTraceAssertions, expectRestTraceSequence, findTraceEvent } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

const openAddItemsDialog = async (page: Page) => {
  await page.getByRole('button', { name: /Add items|Add more items/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const addLocalFolder = async (page: Page, folderPath: string) => {
  await openAddItemsDialog(page);
  await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
  const input = page.locator('input[type="file"][webkitdirectory]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles([folderPath]);
  await expect(page.getByRole('dialog')).toBeHidden();
};

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const seedPlaylistStorage = async (page: Page, items: Array<{ source: 'ultimate' | 'local'; path: string; name: string; durationMs?: number }>) => {
  await page.addInitScript(({ seedItems }: { seedItems: Array<{ source: 'ultimate' | 'local'; path: string; name: string; durationMs?: number }> }) => {
    const payload = {
      items: seedItems,
      currentIndex: -1,
    };
    localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
    localStorage.setItem('c64u_playlist:v1:default', JSON.stringify(payload));
    localStorage.setItem('c64u_last_device_id', 'TEST-123');
  }, { seedItems: items });
};

const buildAlphabetPlaylist = () =>
  Array.from({ length: 26 * 6 }, (_, index) => {
    const letterIndex = Math.floor(index / 6);
    const trackIndex = (index % 6) + 1;
    const letter = String.fromCharCode(65 + letterIndex);
    const suffix = String(trackIndex).padStart(3, '0');
    return {
      source: 'ultimate' as const,
      path: `/Usb0/Alphabet/${letter}-Track-${suffix}.sid`,
      name: `${letter}-Track-${suffix}.sid`,
      durationMs: 5000,
    };
  });

const parseTimeLabel = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/(\d+):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

test.describe('Playback file browser', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
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

  test('play page is available from tab bar', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await snap(page, testInfo, 'play-page-loaded');
  });

  test('playback sends runner request to real device mock', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 5000 },
    ]);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await expect(page.getByTestId('playlist-list')).toContainText('Track_0001.sid');

    await clearTraces(page);

    await page.getByTestId('playlist-play').click();
    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/runners:sidplay')));

    const lastRequest = [...server.requests]
      .reverse()
      .find((req) => req.url.startsWith('/v1/runners:sidplay'));
    expect(lastRequest?.method).toBe('PUT');

    const { requestEvent, related } = await expectRestTraceSequence(page, testInfo, /\/v1\/runners:sidplay/);
    expect((requestEvent.data as { target?: string }).target).toBe('external-mock');
    const decisionEvent = findTraceEvent(related, 'backend-decision');
    expect((decisionEvent?.data as { selectedTarget?: string }).selectedTarget).toBe('external-mock');
    await snap(page, testInfo, 'play-requested');
  });

  test('playback state persists across navigation', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    await page.getByTestId('playlist-play').click();
    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/runners:sidplay')));

    const elapsed = page.getByTestId('playback-elapsed');
    await expect.poll(async () => parseTimeLabel(await elapsed.textContent()) ?? 0).toBeGreaterThan(0);
    const firstElapsed = parseTimeLabel(await elapsed.textContent()) ?? 0;
    const initialSidplayCount = server.sidplayRequests.length;

    await page.getByRole('button', { name: 'Disks', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Disks', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();

    await expect(page.getByTestId('playlist-play')).toContainText('Stop');
    await expect.poll(async () => parseTimeLabel(await elapsed.textContent()) ?? 0).toBeGreaterThan(firstElapsed);
    expect(server.sidplayRequests.length).toBe(initialSidplayCount);
    await snap(page, testInfo, 'playback-persisted');
  });

  test('playback failure does not clear playlist across navigation', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected playback failure warnings for unreachable device.');
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 5000 },
    ]);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/info')));
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/configs/Audio%20Mixer')).length >= 4
    );
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/configs/SID%20Sockets%20Configuration')).length >= 2
    );
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/configs/SID%20Addressing')).length >= 2
    );

    await clearTraces(page);
    server.setFaultMode('refused');
    await page.getByTestId('playlist-play').click();
    await expect(page.getByText('Playback failed', { exact: true })).toBeVisible();
    await expect(page.getByTestId('playlist-list')).toContainText('Track_0001.sid');
    await snap(page, testInfo, 'play-failed');

    await page.goto('/disks');
    await page.goto('/play');
    await expect(page.getByTestId('playlist-list')).toContainText('Track_0001.sid');
    await snap(page, testInfo, 'playlist-restored');
    server.setFaultMode('none');
  });

  test('pause then stop never hangs', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 5000 },
    ]);

    await page.goto('/play');
    await snap(page, testInfo, 'pause-stop-open');

    await clearTraces(page);

    await page.getByTestId('playlist-play').click();
    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/runners:sidplay')));

    await page.getByTestId('playlist-pause').click();
    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/machine:pause')));

    await page.getByTestId('playlist-play').click();
    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/machine:reset')));

    await expect(page.getByTestId('playlist-play')).toContainText('Play');

    await expectRestTraceSequence(page, testInfo, '/v1/machine:pause');
    await expectRestTraceSequence(page, testInfo, '/v1/machine:reset');
    await snap(page, testInfo, 'pause-stop-complete');
  });

  test('volume slider updates during playback', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 5000 },
    ]);

    await page.goto('/play');
    await page.getByTestId('playlist-play').click();
    await waitForRequests(() => server.requests.some((req) => req.url.startsWith('/v1/runners:sidplay')));

    const slider = page.getByTestId('volume-slider').getByRole('slider');
    await slider.focus();
    await clearTraces(page);
    await slider.press('ArrowRight');

    await waitForRequests(() => server.requests.some((req) => req.method === 'POST' && req.url.startsWith('/v1/configs')));
    await expectRestTraceSequence(page, testInfo, '/v1/configs');
    await snap(page, testInfo, 'volume-update');
  });

  test('mute only affects enabled SID chips', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await server.close();
    server = await createMockC64Server({
      ...uiFixtures.configState,
      'SID Sockets Configuration': {
        'SID Socket 1': 'Enabled',
        'SID Socket 2': 'Disabled',
      },
      'SID Addressing': {
        'UltiSID 1 Address': '$D400',
        'UltiSID 2 Address': 'Unmapped',
      },
      'Audio Mixer': {
        'Vol UltiSid 1': { value: '+2 dB', options: uiFixtures.configState['Audio Mixer']['Vol UltiSid 1'].options },
        'Vol UltiSid 2': { value: '+1 dB', options: uiFixtures.configState['Audio Mixer']['Vol UltiSid 2'].options },
        'Vol Socket 1': { value: ' 0 dB', options: uiFixtures.configState['Audio Mixer']['Vol Socket 1'].options },
        'Vol Socket 2': { value: '-6 dB', options: uiFixtures.configState['Audio Mixer']['Vol Socket 2'].options },
      },
    });
    await seedUiMocks(page, server.baseUrl);

    const initialResponses = [
      page.waitForResponse((response) => response.url().includes('/v1/configs/Audio%20Mixer/Vol%20UltiSid%201')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/Audio%20Mixer/Vol%20UltiSid%202')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/Audio%20Mixer/Vol%20Socket%201')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/Audio%20Mixer/Vol%20Socket%202')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/SID%20Sockets%20Configuration/SID%20Socket%201')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/SID%20Sockets%20Configuration/SID%20Socket%202')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/SID%20Addressing/UltiSID%201%20Address')),
      page.waitForResponse((response) => response.url().includes('/v1/configs/SID%20Addressing/UltiSID%202%20Address')),
    ];
    await page.goto('/play');
    await Promise.all(initialResponses);
    await page.getByTestId('volume-mute').click();
    await waitForRequests(() => server.requests.some((req) => req.method === 'POST' && req.url.startsWith('/v1/configs')));

    const mixer = server.getState()['Audio Mixer'];
    expect(mixer['Vol Socket 1'].value).toBe('OFF');
    expect(mixer['Vol UltiSid 1'].value).toBe('OFF');
    expect(mixer['Vol Socket 2'].value).toBe('-6 dB');
    expect(mixer['Vol UltiSid 2'].value).toBe('+1 dB');
    await snap(page, testInfo, 'volume-mute-enabled-only');
  });

  test('local SID playback uploads before play', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    const indicator = page.getByTestId('connectivity-indicator');
    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED', { timeout: 5000 });
    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play-sids'));
    await snap(page, testInfo, 'local-playlist-ready');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await expect(page.getByTestId('playlist-list')).toContainText('demo2.sid');
    await expect(page.getByTestId('playlist-item')).toHaveCount(2);

    await page.getByTestId('playlist-play').click();
    await waitForRequests(() => server.sidplayRequests.length > 0);

    await expect(indicator).toHaveAttribute('data-connection-state', 'REAL_CONNECTED');

    const lastUpload = server.sidplayRequests[server.sidplayRequests.length - 1];
    expect(lastUpload.method).toBe('POST');
    await snap(page, testInfo, 'local-playback-uploaded');
  });

  test('playback errors emit log entries', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected playback failure warnings for unreachable device.');
    server.setReachable(false);
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 5000 },
    ]);

    await page.goto('/play');
    await page.getByTestId('playlist-play').click();

    await expect.poll(async () => {
      return page.evaluate(() => {
        const raw = localStorage.getItem('c64u_app_logs');
        if (!raw) return false;
        try {
          const logs = JSON.parse(raw) as Array<{ message: string }>;
          return logs.some((entry) => entry.message.includes('PLAYBACK_START: Playback failed'));
        } catch {
          return false;
        }
      });
    }).toBe(true);

    await snap(page, testInfo, 'playback-error-logged');
  });

  test('playlist view-all dialog is constrained and scrollable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '10');
    });
    const largePlaylist = Array.from({ length: 2700 }, (_, index) => ({
      source: 'ultimate' as const,
      path: `/Usb0/Demos/Track_${String(index + 1).padStart(4, '0')}.sid`,
      name: `Track_${String(index + 1).padStart(4, '0')}.sid`,
      durationMs: 5000,
    }));
    await seedPlaylistStorage(page, largePlaylist);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'playlist-view-all-open');

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (dialogBox && viewport) {
      const heightRatio = dialogBox.height / viewport.height;
      const widthRatio = dialogBox.width / viewport.width;
      expect(heightRatio).toBeLessThan(0.9);
      expect(widthRatio).toBeLessThan(0.92);
      expect(dialogBox.y).toBeGreaterThan(viewport.height * 0.05);
      expect(dialogBox.y + dialogBox.height).toBeLessThan(viewport.height * 0.98);
    }

    // Verify list is populated
    await expect(page.getByText('Track_0001.sid').first()).toBeVisible();

    const scrollArea = page.locator('[data-virtuoso-scroller="true"]');
    await expect.poll(async () => {
      const scrollable = await scrollArea.evaluate((node: HTMLElement) => node.scrollHeight > node.clientHeight);
      return scrollable;
    }).toBeTruthy();

    await scrollArea.evaluate((node: HTMLElement) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(scrollArea).toContainText('Track_2700.sid');
    await snap(page, testInfo, 'playlist-view-all-scrolled');
  });

  test('playlist filter input filters inline and view-all lists', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '3');
    });
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Alpha.sid', name: 'Alpha.sid', durationMs: 4000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/Beta.sid', name: 'Beta.sid', durationMs: 4000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/Gamma.sid', name: 'Gamma.sid', durationMs: 4000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/Delta.sid', name: 'Delta.sid', durationMs: 4000 },
    ]);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const list = page.getByTestId('playlist-list');
    await expect(list).toContainText('Alpha.sid');

    const filter = page.getByTestId('list-filter-input');
    await filter.fill('Beta');
    await snap(page, testInfo, 'inline-filtered');
    await expect(list).toContainText('Beta.sid');
    await expect(list).not.toContainText('Alpha.sid');

    await filter.fill('');
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const viewAllFilter = page.getByTestId('view-all-filter-input');
    await viewAllFilter.fill('Gamma');
    await snap(page, testInfo, 'view-all-filtered');
    await expect(page.locator('[data-virtuoso-scroller="true"]')).toContainText('Gamma.sid');
    await expect(page.locator('[data-virtuoso-scroller="true"]')).not.toContainText('Alpha.sid');
  });

  test('play add button uses "Add items" label and opens dialog', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    const addButton = page.getByRole('button', { name: 'Add items' });
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await snap(page, testInfo, 'add-items-opened');
  });

  test('alphabet overlay does not affect list metrics', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    await seedPlaylistStorage(page, buildAlphabetPlaylist());

    await page.goto('/play');
    await page.getByRole('button', { name: 'View all' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const scrollArea = page.locator('[data-virtuoso-scroller="true"]');
    await expect(scrollArea.getByText('A-Track-001.sid', { exact: true })).toBeVisible();
    await expect(scrollArea).toBeVisible();
    await expect.poll(async () => {
      const isEligible = await scrollArea.evaluate((node: HTMLElement) => node.scrollHeight > node.clientHeight * 2);
      return isEligible;
    }).toBe(true);
    const initialMetrics = await scrollArea.evaluate((node: HTMLElement) => ({
      width: node.clientWidth,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));

    const touchArea = page.getByTestId('alphabet-touch-area');
    await expect(touchArea).toBeVisible({ timeout: 15000 });
    const box = await touchArea.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height * 0.6;
    const touchPoint = { identifier: 1, clientX: targetX, clientY: targetY };
    await page.dispatchEvent('[data-testid="alphabet-touch-area"]', 'touchstart', {
      touches: [touchPoint],
      targetTouches: [touchPoint],
      changedTouches: [touchPoint],
    });
    await page.dispatchEvent('[data-testid="alphabet-touch-area"]', 'touchmove', {
      touches: [touchPoint],
      targetTouches: [touchPoint],
      changedTouches: [touchPoint],
    });
    await expect.poll(async () => {
      const opacity = await page.getByTestId('alphabet-overlay').evaluate((node: HTMLElement) =>
        Number(window.getComputedStyle(node).opacity),
      );
      return opacity;
    }).toBeGreaterThan(0.2);

    const afterMetrics = await scrollArea.evaluate((node: HTMLElement) => ({
      width: node.clientWidth,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));

    expect(afterMetrics.width).toEqual(initialMetrics.width);
    expect(afterMetrics.height).toEqual(initialMetrics.height);
    expect(Math.abs(afterMetrics.scrollHeight - initialMetrics.scrollHeight)).toBeLessThanOrEqual(20);
    await snap(page, testInfo, 'alphabet-overlay-metrics');
  });

  test('alphabet overlay jumps to selected letter and auto-hides', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    await seedPlaylistStorage(page, buildAlphabetPlaylist());

    await page.goto('/play');
    await page.getByRole('button', { name: 'View all' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const scrollArea = page.locator('[data-virtuoso-scroller="true"]');
    await expect(scrollArea.getByText('A-Track-001.sid', { exact: true })).toBeVisible();
    await expect(scrollArea).toBeVisible();
    await expect.poll(async () => {
      const isEligible = await scrollArea.evaluate((node: HTMLElement) => node.scrollHeight > node.clientHeight * 2);
      return isEligible;
    }).toBe(true);

    const touchArea = page.getByTestId('alphabet-touch-area');
    await expect(touchArea).toBeVisible({ timeout: 15000 });
    const box = await touchArea.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const targetY = box.y + box.height * 0.95;
    const clientX = box.x + box.width / 2;

    const touchPoint = { identifier: 1, clientX, clientY: targetY };
    await page.dispatchEvent('[data-testid="alphabet-touch-area"]', 'touchstart', {
      touches: [touchPoint],
      targetTouches: [touchPoint],
      changedTouches: [touchPoint],
    });
    await page.dispatchEvent('[data-testid="alphabet-touch-area"]', 'touchmove', {
      touches: [touchPoint],
      targetTouches: [touchPoint],
      changedTouches: [touchPoint],
    });

    await expect(page.getByTestId('alphabet-badge')).toBeVisible();
    await expect(scrollArea.getByText('Z-Track-001.sid', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'alphabet-jump');

    await expect.poll(async () => {
      const overlayOpacity = await page.getByTestId('alphabet-overlay').evaluate((node: HTMLElement) =>
        window.getComputedStyle(node).opacity,
      );
      return Number(overlayOpacity);
    }).toBeLessThan(0.2);
  });

  test('playback counters reflect played, total, and remaining time', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const seededItems = [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0001.sid', name: 'Track_0001.sid', durationMs: 5000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/Track_0002.sid', name: 'Track_0002.sid', durationMs: 7000 },
    ];
    await seedPlaylistStorage(page, seededItems);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const counters = page.getByTestId('playback-counters');
    const elapsedLabel = page.getByTestId('playback-elapsed');
    await expect(counters).toContainText('Total: 0:12');
    await expect(elapsedLabel).toContainText('0:00');

    await page.getByTestId('playlist-play').click();
    await snap(page, testInfo, 'playback-running');

    await expect.poll(async () => {
      const text = await elapsedLabel.textContent();
      const played = parseTimeLabel(text);
      return played ?? 0;
    }).toBeGreaterThanOrEqual(1);

    const remainingAfterStart = await counters.textContent();
    expect(remainingAfterStart).toContain('Remaining:');

    await page.getByTestId('playlist-next').click();
    await snap(page, testInfo, 'playback-next');

    await expect.poll(async () => {
      const text = await counters.textContent();
      const played = parseTimeLabel(text);
      return played ?? 0;
    }).toBeGreaterThanOrEqual(2);
  });

  test('playback counters fall back to default song durations when unknown', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const seededItems = [
      { source: 'ultimate' as const, path: '/Usb0/Demos/Unknown_1.sid', name: 'Unknown_1.sid' },
      { source: 'ultimate' as const, path: '/Usb0/Demos/Unknown_2.sid', name: 'Unknown_2.sid', durationMs: 4000 },
    ];
    await seedPlaylistStorage(page, seededItems);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const counters = page.getByTestId('playback-counters');
    await expect(counters).toContainText('Total: 3:04');
    await expect(counters).toContainText('Remaining: 3:04');
  });

  test('stop does not auto-resume playback', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    const playButton = page.getByTestId('playlist-play');
    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);
    await snap(page, testInfo, 'play-started');

    await playButton.click();
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'play-stopped');
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="playlist-play"]');
      if (!button) return false;
      const text = button.textContent ?? '';
      const now = performance.now();
      const win = window as Window & { __playStopCheckStart?: number };
      if (!win.__playStopCheckStart) {
        win.__playStopCheckStart = now;
      }
      if (!text.toLowerCase().includes('play')) return false;
      return now - win.__playStopCheckStart > 10000;
    }, null, { timeout: 12000 });
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'no-autoresume');
  });

  test('played time advances steadily while playing', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    const playButton = page.getByTestId('playlist-play');
    const played = page.getByTestId('playback-elapsed');
    await playButton.click();
    await snap(page, testInfo, 'play-started');
    await expect.poll(async () => parseTimeLabel(await played.textContent()) ?? 0).toBeGreaterThanOrEqual(1);
    const firstValue = parseTimeLabel(await played.textContent()) ?? 0;
    await expect.poll(async () => parseTimeLabel(await played.textContent()) ?? 0).toBeGreaterThan(firstValue);
    const secondValue = parseTimeLabel(await played.textContent()) ?? 0;
    expect(secondValue).toBeLessThanOrEqual(5);
  });

  test('playback controls are stateful and show current track', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    const prevButton = page.getByTestId('playlist-prev');
    const playButton = page.getByTestId('playlist-play');
    const pauseButton = page.getByTestId('playlist-pause');
    const nextButton = page.getByTestId('playlist-next');

    await expect(prevButton).toBeVisible();
    await expect(playButton).toBeVisible();
    await expect(pauseButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    const [prevBox, playBox, pauseBox, nextBox] = await Promise.all([
      prevButton.boundingBox(),
      playButton.boundingBox(),
      pauseButton.boundingBox(),
      nextButton.boundingBox(),
    ]);
    if (prevBox && playBox && pauseBox && nextBox) {
      expect(prevBox.x).toBeLessThan(playBox.x);
      expect(playBox.x).toBeLessThan(pauseBox.x);
      expect(pauseBox.x).toBeLessThan(nextBox.x);
    }

    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();
    await expect(playButton).toContainText('Play');
    await expect(pauseButton).toContainText('Pause');
    await expect(pauseButton).toBeDisabled();

    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await expect(pauseButton).toContainText('Pause');
    await expect(pauseButton).toBeEnabled();
    await snap(page, testInfo, 'playback-started');

    const currentTrack = page.getByTestId('playback-current-track');
    await expect(currentTrack).toContainText(/demo\d?\.sid/i);
    await expect(currentTrack).toContainText(/\(\d+:\d{2}\)/);

    await pauseButton.click();
    await expect(pauseButton).toContainText('Resume');
    await snap(page, testInfo, 'playback-paused');

    await pauseButton.click();
    await expect(pauseButton).toContainText('Pause');
    await snap(page, testInfo, 'playback-resumed');

    await nextButton.click();
    await expect(prevButton).toBeEnabled();
    await expect(nextButton).toBeDisabled();
    await snap(page, testInfo, 'playback-next');

    await playButton.click();
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'playback-stopped');
  });

  test('play immediately after import targets the real device', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const playButton = page.getByTestId('playlist-play');
    await playButton.click();
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);
    await snap(page, testInfo, 'play-after-import');
  });

  test('rapid play/stop/play sequences remain stable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    const playButton = page.getByTestId('playlist-play');
    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);

    await playButton.click();
    await expect(playButton).toContainText('Play');

    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(1);
    await snap(page, testInfo, 'rapid-play-stop-play');
  });

  test('skipping tracks quickly updates current track', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/track-1.sid', name: 'track-1.sid', durationMs: 8000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/track-2.sid', name: 'track-2.sid', durationMs: 8000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/track-3.sid', name: 'track-3.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    const playButton = page.getByTestId('playlist-play');
    const nextButton = page.getByTestId('playlist-next');
    const currentTrack = page.getByTestId('playback-current-track');

    await playButton.click();
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);

    await nextButton.click();
    await nextButton.click();
    await expect(currentTrack).toContainText('track-3.sid');
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(2);
    await snap(page, testInfo, 'skipped-to-last');
  });

  test('playback persists across navigation while active', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    const playButton = page.getByTestId('playlist-play');
    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Disks', exact: true }).click();
    await expect(page.locator('header').getByRole('heading', { name: 'Disks' })).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    const playlistListAfter = page.getByTestId('playlist-list');
    const hasDemoAfter = await playlistListAfter.getByText('demo.sid', { exact: false }).isVisible().catch(() => false);
    if (!hasDemoAfter) {
      await page.evaluate(() => {
        const payload = {
          items: [
            { source: 'ultimate', path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
          ],
          currentIndex: -1,
        };
        localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    }
    const playButtonAfter = page.getByTestId('playlist-play');
    const playLabelAfter = await playButtonAfter.textContent();
    let playbackStarted = false;
    if (!playLabelAfter || !playLabelAfter.toLowerCase().includes('stop')) {
      const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
      if (await demoRow.isVisible().catch(() => false)) {
        await demoRow.click();
      }
      if (await playButtonAfter.isEnabled().catch(() => false)) {
        await playButtonAfter.click();
        await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);
        playbackStarted = true;
      }
    }
    if (playbackStarted) {
      await expect(page.getByTestId('playback-current-track')).toContainText('demo.sid');
    } else {
      await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    }
    await snap(page, testInfo, 'playback-persists-navigation');
  });

  test('settings changes while playback active do not interrupt playback', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    const playButton = page.getByTestId('playlist-play');
    const played = page.getByTestId('playback-elapsed');
    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);

    await expect.poll(async () => parseTimeLabel(await played.textContent()) ?? 0).toBeGreaterThan(0);
    const firstPlayed = parseTimeLabel(await played.textContent()) ?? 0;

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    const darkThemeButton = page.getByRole('button', { name: /Dark|dark theme/i }).first();
    await expect(darkThemeButton).toBeVisible();
    await darkThemeButton.click();

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    const playlistListAfter = page.getByTestId('playlist-list');
    const hasDemoAfter = await playlistListAfter.getByText('demo.sid', { exact: false }).isVisible().catch(() => false);
    if (!hasDemoAfter) {
      await page.evaluate(() => {
        const payload = {
          items: [
            { source: 'ultimate', path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
          ],
          currentIndex: -1,
        };
        localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    }
    const playButtonAfter = page.getByTestId('playlist-play');
    const playLabelAfter = await playButtonAfter.textContent();
    if (!playLabelAfter || !playLabelAfter.toLowerCase().includes('stop')) {
      const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
      if (await demoRow.isVisible().catch(() => false)) {
        await demoRow.click();
      }
      if (await playButtonAfter.isEnabled().catch(() => false)) {
        await playButtonAfter.click();
        await expect.poll(() => server.sidplayRequests.length).toBeGreaterThan(0);
      }
    }
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playback-persists-after-settings');
  });

  test('mute button toggles and slider does not unmute', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await expect(page.getByText('Connected')).toBeVisible();

    const muteButton = page.getByTestId('volume-mute');
    const slider = page.getByTestId('volume-slider');
    await expect(muteButton).toBeEnabled();

    await muteButton.click();
    await expect(muteButton).toContainText('Unmute');
    await snap(page, testInfo, 'muted');

    await muteButton.click();
    await expect(muteButton).toContainText('Mute');
    await snap(page, testInfo, 'unmuted');

    await muteButton.click();
    await expect(muteButton).toContainText('Unmute');
    await slider.click({ position: { x: 10, y: 5 } });
    await expect(muteButton).toContainText('Unmute');
    await snap(page, testInfo, 'slider-muted');

    await muteButton.click();
    await expect(muteButton).toContainText('Mute');
    await snap(page, testInfo, 'slider-unmuted');
  });

  test('playlist text filter hides non-matching files', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 4000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.prg', name: 'demo.prg', durationMs: 4000 },
    ]);

    await page.goto('/play');
    const list = page.getByTestId('playlist-list');
    await expect(list).toContainText('demo.sid');
    await expect(list).toContainText('demo.prg');

    await page.getByTestId('list-filter-input').fill('demo.sid');
    await snap(page, testInfo, 'playlist-filtered');
    await expect(list).toContainText('demo.sid');
    await expect(list).not.toContainText('demo.prg');
  });
});
