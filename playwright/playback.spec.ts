import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Locator, Page, TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const waitForRequests = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10000 }).toBe(true);
};

const openAddItemsDialog = async (page: Page) => {
  await page.getByRole('button', { name: /Add items|Add more items/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
};

const selectEntryCheckbox = async (container: Page | Locator, name: string) => {
  const row = container.getByText(name, { exact: true }).locator('..').locator('..');
  const checkbox = row.getByRole('checkbox');
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.click({ force: true });
};

const openRemoteFolder = async (container: Page | Locator, name: string) => {
  const row = container.getByText(name, { exact: true }).locator('..').locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
};

const ensureRemoteRoot = async (container: Page | Locator) => {
  const rootButton = container.getByTestId('navigate-root');
  if (!(await rootButton.isVisible())) return;
  if (!(await rootButton.isEnabled())) return;
  await rootButton.click();
};

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const seedPlaylistStorage = async (page: Page, items: Array<{ source: 'ultimate' | 'local'; path: string; name: string; durationMs?: number }>) => {
  await page.addInitScript(({ seedItems }) => {
    const payload = {
      items: seedItems,
      currentIndex: -1,
    };
    localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
  }, { seedItems: items });
};

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
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await snap(page, testInfo, 'play-page-loaded');
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
      expect(heightRatio).toBeLessThan(0.9);
      expect(dialogBox.y).toBeGreaterThan(viewport.height * 0.05);
      expect(dialogBox.y + dialogBox.height).toBeLessThan(viewport.height * 0.98);
    }

    const scrollArea = page.getByTestId('action-list-scroll');
    const scrollable = await scrollArea.evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(scrollable).toBeTruthy();

    await scrollArea.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(scrollArea).toContainText('Track_2700.sid');
    await snap(page, testInfo, 'playlist-view-all-scrolled');
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
    await expect(counters).toContainText('Total: 0:12');

    await page.getByTestId('playlist-play').click();
    await page.waitForTimeout(1200);
    await snap(page, testInfo, 'playback-running');

    await expect.poll(async () => {
      const text = await counters.textContent();
      const played = parseTimeLabel(text);
      return played ?? 0;
    }).toBeGreaterThanOrEqual(1);

    const remainingAfterStart = await counters.textContent();
    expect(remainingAfterStart).toContain('Remaining:');

    await page.getByTestId('playlist-next').click();
    await page.waitForTimeout(1200);
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

  test('playback controls are stateful and show current track', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
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

  test('volume slider updates non-muted SID outputs', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const initialState = server.getState()['Audio Mixer'];

    await page.goto('/play');
    await expect(page.getByText('Connected')).toBeVisible();
    const slider = page.getByTestId('volume-slider').getByRole('slider');
    await expect(slider).toBeVisible();
    await expect(page.getByTestId('volume-mute')).toBeEnabled();
    await expect(slider).toBeEnabled();
    await snap(page, testInfo, 'volume-slider-ready');

    await slider.focus();
    await slider.press('ArrowRight');
    await slider.press('ArrowRight');
    await snap(page, testInfo, 'volume-slider-adjusted');

    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).not.toBe(initialState['Vol UltiSid 2'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).not.toBe(initialState['Vol Socket 1'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).not.toBe(initialState['Vol Socket 2'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 1'].value).toBe(initialState['Vol UltiSid 1'].value);
    await snap(page, testInfo, 'volume-updated');
  });

  test('pause mutes SID outputs and resume restores them', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const initialState = server.getState()['Audio Mixer'];
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const playButton = page.getByTestId('playlist-play');
    const pauseButton = page.getByTestId('playlist-pause');

    await playButton.click();
    await expect(pauseButton).toBeEnabled();
    await snap(page, testInfo, 'play-started');

    await pauseButton.click();
    await snap(page, testInfo, 'paused');

    await expect.poll(() => {
      const audio = server.getState()['Audio Mixer'];
      return [
        audio['Vol UltiSid 1'].value,
        audio['Vol UltiSid 2'].value,
        audio['Vol Socket 1'].value,
        audio['Vol Socket 2'].value,
      ].every((value) => value === 'OFF');
    }).toBe(true);
    await snap(page, testInfo, 'sid-muted');

    await pauseButton.click();
    await snap(page, testInfo, 'resumed');

    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 1'].value).toBe(initialState['Vol UltiSid 1'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe(initialState['Vol UltiSid 2'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe(initialState['Vol Socket 1'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe(initialState['Vol Socket 2'].value);

    const pauseIndex = server.requests.findIndex((req) => req.url.includes('/v1/machine:pause'));
    const resumeIndex = server.requests.findIndex((req) => req.url.includes('/v1/machine:resume'));
    const configIndices = server.requests
      .map((req, index) => (req.url.includes('/v1/configs') ? index : -1))
      .filter((index) => index >= 0);
    const configBetweenPauseAndResume = configIndices.filter((index) => index > pauseIndex && index < resumeIndex);
    expect(pauseIndex).toBeGreaterThan(-1);
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(configBetweenPauseAndResume.length).toBeGreaterThan(0);
    await snap(page, testInfo, 'sid-restored');
  });

  test('native folder picker adds local files to playlist', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      (window as Window & { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'android';
      (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride = true;

      const treeUri = 'content://tree/primary%3AMusic';
      const entriesByPath: Record<string, Array<{ type: 'file' | 'dir'; name: string; path: string }>> = {
        '/': [
          { type: 'file', name: 'demo.sid', path: '/demo.sid' },
          { type: 'dir', name: 'Apps', path: '/Apps' },
          { type: 'dir', name: 'Disks', path: '/Disks' },
        ],
        '/Apps': [{ type: 'file', name: 'launch.prg', path: '/Apps/launch.prg' }],
        '/Disks': [
          { type: 'file', name: 'disk.d64', path: '/Disks/disk.d64' },
          { type: 'dir', name: 'Deep', path: '/Disks/Deep' },
        ],
        '/Disks/Deep': [{ type: 'file', name: 'deep.sid', path: '/Disks/Deep/deep.sid' }],
      };

      const pickDirectory = async () => ({ treeUri, rootName: 'Local Music', permissionPersisted: true });
      const calls: Array<{ path: string }> = [];
      (window as Window & { __c64uSafCalls?: Array<{ path: string }> }).__c64uSafCalls = calls;
      const listChildren = async ({ treeUri: requestUri, path = '/' }: { treeUri: string; path?: string }) => {
        if (requestUri !== treeUri) {
          throw new Error('Unexpected treeUri');
        }
        const normalized = path && path !== '/' ? path.replace(/\/+$/, '') : '/';
        const key = normalized === '' ? '/' : normalized;
        calls.push({ path: key });
        await new Promise((resolve) => setTimeout(resolve, 600));
        return { entries: entriesByPath[key] ?? [] };
      };
      const readFileFromTree = async () => ({ data: '' });
      (window as Window & { __c64uFolderPickerOverride?: any }).__c64uFolderPickerOverride = {
        pickDirectory,
        listChildren,
        readFileFromTree,
        readFile: async () => ({ data: '' }),
        getPersistedUris: async () => ({ uris: [] }),
      };
    });

    await page.goto('/play');
    await snap(page, testInfo, 'playlist-empty');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await snap(page, testInfo, 'choose-source');

    await page.getByRole('button', { name: 'Add folder' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const overlay = page.getByTestId('add-items-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Scanning');
    await expect.poll(async () => page.evaluate(() => (window as any).__c64uSafCalls?.length ?? 0)).toBeGreaterThan(0);
    await expect.poll(async () => page.evaluate(() => (window as any).__c64uSafCalls?.length ?? 0)).toBeGreaterThan(2);
    await snap(page, testInfo, 'playlist-scan-overlay');
    await expect(page.locator('[data-testid="add-items-overlay"]')).toHaveCount(0);
    const playlistList = page.getByTestId('playlist-list');
    await expect(playlistList).toContainText('demo.sid');
    await expect(playlistList).toContainText('launch.prg');
    await expect(playlistList).toContainText('disk.d64');
    await expect(playlistList).toContainText('deep.sid');
    await snap(page, testInfo, 'playlist-with-local-files');
  });

  test('SAF scan shows no supported files only after enumeration', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings', description: 'Expected destructive toast for empty SAF scan.' });
    await page.addInitScript(() => {
      (window as Window & { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'android';
      (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride = true;

      const treeUri = 'content://tree/primary%3AEmpty';
      const entriesByPath: Record<string, Array<{ type: 'file' | 'dir'; name: string; path: string }>> = {
        '/': [{ type: 'file', name: 'notes.txt', path: '/notes.txt' }],
      };

      const pickDirectory = async () => ({ treeUri, rootName: 'Empty', permissionPersisted: true });
      const listChildren = async ({ treeUri: requestUri, path = '/' }: { treeUri: string; path?: string }) => {
        if (requestUri !== treeUri) throw new Error('Unexpected treeUri');
        await new Promise((resolve) => setTimeout(resolve, 75));
        return { entries: entriesByPath[path || '/'] ?? [] };
      };
      (window as Window & { __c64uFolderPickerOverride?: any }).__c64uFolderPickerOverride = {
        pickDirectory,
        listChildren,
        readFileFromTree: async () => ({ data: '' }),
        readFile: async () => ({ data: '' }),
        getPersistedUris: async () => ({ uris: [] }),
      };
    });

    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();

    const overlay = page.getByTestId('add-items-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByText('No supported files')).toHaveCount(0);
    await snap(page, testInfo, 'saf-scan-overlay');

    await expect(page.locator('[data-testid="add-items-overlay"]')).toHaveCount(0);
    await expect(page.getByText('No supported files', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'saf-no-supported-files');
  });

  test('local browsing filters supported files and plays SID upload', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-open');
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-populated');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    expect(server.sidplayRequests[0].method).toBe('POST');
    await snap(page, testInfo, 'sid-playback-requested');
  });

  test('songlengths metadata is applied for local SIDs', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'songlengths-playlist');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    await snap(page, testInfo, 'songlengths-playback');
  });

  test('local source browser filters supported files', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'local-source-added');

    await openAddItemsDialog(page);
    await expect(page.getByRole('button', { name: 'local-play' })).toBeVisible();
    await page.getByRole('button', { name: 'local-play' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('demo.sid', { exact: true })).toBeVisible();
    await expect(dialog.getByText('demo.txt')).toHaveCount(0);
    await snap(page, testInfo, 'local-source-browser');
  });

  test('folder play populates playlist dialog', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '1');
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-preview');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.d64');
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('demo.sid', { exact: true })).toBeVisible();
    await expect(dialog.getByText('demo.d64', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'playlist-view-all');
  });

  test('local folder input accepts directory', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-populated');
  });

  test('reshuffle changes playlist order and keeps current track index', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const playlist = {
      items: Array.from({ length: 6 }, (_, index) => ({
        source: 'ultimate',
        path: `/Usb0/Demos/shuffle-${index}.sid`,
        name: `shuffle-${index}.sid`,
        durationMs: 5000,
        songNr: 1,
        sourceId: null,
      })),
      currentIndex: 0,
    };

    await page.addInitScript((payload) => {
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
    }, playlist);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const shuffleCheckbox = page.getByText('Shuffle').locator('..').getByRole('checkbox');
    await shuffleCheckbox.click();

    await page.getByTestId('playlist-play').click();
    await expect(page.getByTestId('playback-current-track')).toContainText('shuffle-0.sid');

    const getTitles = async () =>
      page.getByTestId('playlist-item').locator('button').filter({ hasText: /\.sid$/i }).allTextContents();

    const beforeTitles = await getTitles();
    const currentTrack = 'shuffle-0.sid';
    const beforeIndex = beforeTitles.indexOf(currentTrack);

    await page.getByRole('button', { name: 'Reshuffle' }).click();
    await snap(page, testInfo, 'reshuffle-clicked');

    const afterTitles = await getTitles();
    const afterIndex = afterTitles.indexOf(currentTrack);

    expect(afterTitles.join('|')).not.toBe(beforeTitles.join('|'));
    expect(afterIndex).toBe(beforeIndex);
  });

  test('local folder without supported files shows warning', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected warning when no supported files are found.');
    await page.goto('/play');
    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-open');
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-unsupported')]);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('add-items-progress')).toContainText('No supported files');
    await snap(page, testInfo, 'no-supported-files');
  });

  test('ultimate browsing lists FTP entries and mounts remote disk image', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    const dialog = page.getByRole('dialog');
    await ensureRemoteRoot(dialog);
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await openRemoteFolder(dialog, 'Turrican II');
    await expect(dialog.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-folder');
    await selectEntryCheckbox(dialog, 'Disk 1.d64');
    await page.getByTestId('add-items-confirm').click();
    await snap(page, testInfo, 'playlist-updated');
    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'Disk 1.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'mount-requested');
  });

  test('C64U browser remembers last path and supports root', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    const dialog = page.getByRole('dialog');
    await ensureRemoteRoot(dialog);
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await expect(dialog.getByText(/Path: \/Usb0\/Games/)).toBeVisible();
    await snap(page, testInfo, 'c64u-path-remembered');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await snap(page, testInfo, 'dialog-closed');

    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await expect(page.getByText(/Path: \/Usb0\/Games/)).toBeVisible();
    await page.getByTestId('navigate-root').click();
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
  });

  test('disk image triggers mount and autostart sequence', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');
    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/machine:readmem')),
    );
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/machine:writemem')),
    );
    await snap(page, testInfo, 'autostart-complete');
  });

  test('FTP failure shows error toast', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected error toast for FTP failure.');
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port + 25,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);

    await page.goto('/play');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await expect(page.getByText('Browse failed', { exact: true }).first()).toBeVisible();
    await snap(page, testInfo, 'browse-failed');
  });

  test('end-to-end add, browse, and play (local + remote)', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page');
    await snap(page, testInfo, 'play-open');

    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-dialog');
    await snap(page, testInfo, 'add-items-open');

    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'local-library-added');
    await snap(page, testInfo, 'local-playlist-updated');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    await snap(page, testInfo, 'local-playback');
    await snap(page, testInfo, 'local-playback-started');

    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    const dialog = page.getByRole('dialog');
    await ensureRemoteRoot(dialog);
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await openRemoteFolder(dialog, 'Turrican II');
    await snap(page, testInfo, 'remote-browser');
    await snap(page, testInfo, 'remote-browser');

    await selectEntryCheckbox(dialog, 'Disk 1.d64');
    await page.getByTestId('add-items-confirm').click();
    await snap(page, testInfo, 'remote-library-added');
    await snap(page, testInfo, 'remote-playlist-updated');

    await expect(page.getByTestId('playlist-list')).toContainText('Disk 1.d64');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'Disk 1.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'remote-playback');
    await snap(page, testInfo, 'remote-playback-started');
  });

  test('add to playlist queues items without auto-play', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await expect.poll(() => server.sidplayRequests.length).toBe(0);
    await snap(page, testInfo, 'no-autoplay');
  });

  test('prev/next navigates within playlist', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'first-track-playing');

    await page.getByTestId('playlist-next').click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    await snap(page, testInfo, 'next-track-playing');

    await page.getByTestId('playlist-prev').click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/drives/a:mount')).length > 1,
    );
    await snap(page, testInfo, 'prev-track-playing');
  });

  test('transport controls toggle play, pause, and stop', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    const playButton = page.getByTestId('playlist-play');
    const pauseButton = page.getByTestId('playlist-pause');
    await expect(playButton).toBeDisabled();
    await expect(pauseButton).toBeDisabled();

    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    const before = await Promise.all([
      page.getByTestId('playlist-prev').boundingBox(),
      playButton.boundingBox(),
      pauseButton.boundingBox(),
      page.getByTestId('playlist-next').boundingBox(),
    ]);

    await expect(playButton).toBeEnabled();
    await playButton.click();
    await waitForRequests(() =>
      server.sidplayRequests.length > 0 ||
      server.requests.some((req) => req.url.startsWith('/v1/drives/a:mount')),
    );
    await snap(page, testInfo, 'play-started');
    await expect(playButton).toContainText('Stop');
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(pauseButton).toContainText('Resume');
    await snap(page, testInfo, 'paused');
    await playButton.click();
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'stopped');

    const after = await Promise.all([
      page.getByTestId('playlist-prev').boundingBox(),
      playButton.boundingBox(),
      pauseButton.boundingBox(),
      page.getByTestId('playlist-next').boundingBox(),
    ]);

    expect(after.map((box) => box?.x)).toEqual(before.map((box) => box?.x));
  });

  test('playlist selection supports select all and remove selected', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await page.getByRole('button', { name: 'Select all' }).click();
    await page.getByRole('button', { name: 'Remove selected items' }).click();
    await expect(page.getByTestId('playlist-list')).toContainText('No tracks in playlist yet.');
    await snap(page, testInfo, 'playlist-cleared');
    await snap(page, testInfo, 'playlist-removed');
  });

  test('playlist persists after reload', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-saved');

    await page.reload();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-restored');
  });

  test('upload handler tolerates empty/binary response', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    let sidplayCalls = 0;
    await page.route('**/v1/runners:sidplay**', async (route: any) => {
      sidplayCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from([0, 0, 0, 0, 1, 2, 3]),
      });
    });

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await expect.poll(() => sidplayCalls).toBeGreaterThan(0);
    await snap(page, testInfo, 'sid-uploaded');
  });
});
