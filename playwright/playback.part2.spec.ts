import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Locator, Page, TestInfo } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { clearTraces, enableTraceAssertions, expectFtpTraceSequence } from './traceUtils';
import { enableGoldenTrace } from './goldenTraceRegistry';
import { clickSourceSelectionButton } from './sourceSelection';

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
  const row = container.locator('[data-testid="source-entry-row"]', { hasText: name }).first();
  await row.click();
};

const ensureRemoteRoot = async (container: Page | Locator) => {
  const rootButton = container.getByTestId('navigate-root');
  const visible = await rootButton.isVisible().catch(() => false);
  if (!visible) return;
  const disabledAttr = await rootButton.getAttribute('disabled').catch((): null => null);
  const ariaDisabled = await rootButton.getAttribute('aria-disabled').catch((): null => null);
  if (disabledAttr !== null || ariaDisabled === 'true') return;
  try {
    await rootButton.click({ timeout: 2000 });
  } catch {
    // If it became disabled, we are already at root; ignore.
  }
};

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const sectorsPerTrack1541 = (track: number) => {
  if (track <= 17) return 21;
  if (track <= 24) return 19;
  if (track <= 30) return 18;
  return 17;
};

const d64Offset = (track: number, sector: number) => {
  let offset = 0;
  for (let t = 1; t < track; t += 1) {
    offset += sectorsPerTrack1541(t);
  }
  return (offset + sector) * 256;
};

const buildTestD64 = () => {
  const totalSectors = Array.from({ length: 35 }, (_, idx) => sectorsPerTrack1541(idx + 1))
    .reduce((sum, value) => sum + value, 0);
  const buffer = Buffer.alloc(totalSectors * 256, 0);

  const dirOffset = d64Offset(18, 1);
  buffer[dirOffset] = 0;
  buffer[dirOffset + 1] = 0;
  buffer[dirOffset + 2] = 0x82;
  buffer[dirOffset + 3] = 1;
  buffer[dirOffset + 4] = 0;
  const name = Buffer.from('DMA-DEMO', 'ascii');
  name.copy(buffer, dirOffset + 5);
  buffer.fill(0xa0, dirOffset + 5 + name.length, dirOffset + 21);

  const prgOffset = d64Offset(1, 0);
  buffer[prgOffset] = 0;
  const prgPayload = Buffer.from([0x01, 0x08, 0x00, 0x00, 0x0a, 0x00, 0x00]);
  buffer[prgOffset + 1] = prgPayload.length;
  prgPayload.copy(buffer, prgOffset + 2);

  return buffer;
};

const createTempDiskDirectory = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c64u-dma-'));
  fs.writeFileSync(path.join(dir, 'demo.d64'), buildTestD64());
  return dir;
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

const parseTimeLabel = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/(\d+):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

test.describe('Playback file browser (part 2)', () => {
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

  test('songlengths discovery shows path and durations', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const songlengthsPath = page.getByText('/local-play-songlengths/songlengths.md5');
    await expect(songlengthsPath).toBeVisible();

    const list = page.getByTestId('playlist-list');
    await expect(list).toContainText('demo.sid');
    await expect(list).toContainText('0:30');
    await snap(page, testInfo, 'songlengths-loaded');
  });

  test('songlengths.txt discovery shows path and durations', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths-txt')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const songlengthsPath = page.getByText('/local-play-songlengths-txt/songlengths.txt');
    await expect(songlengthsPath).toBeVisible();

    const list = page.getByTestId('playlist-list');
    await expect(list).toContainText('demo.sid');
    await expect(list).toContainText('0:25');
    await snap(page, testInfo, 'songlengths-txt-loaded');
  });

  test('DOCUMENTS songlengths are discovered for local folders', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths-documents')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const songlengthsPath = page.getByText('/DOCUMENTS/songlengths.md5');
    await expect(songlengthsPath).toBeVisible();
    await snap(page, testInfo, 'documents-songlengths');
  });

  test('playlist menu shows size and date', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const row = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
    await row.getByRole('button', { name: 'Item actions' }).click();
    const sizeItem = page.getByRole('menuitem', { name: /Size:/i });
    const dateItem = page.getByRole('menuitem', { name: /Date:/i });
    await expect(sizeItem).toBeVisible();
    await expect(dateItem).toBeVisible();
    await expect(sizeItem).not.toContainText('—');
    await expect(dateItem).not.toContainText('—');
    await snap(page, testInfo, 'playlist-size-date');
  });

  test('playlist menu shows size and date for C64 Ultimate items', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await page.goto('/play');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clearTraces(page);
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Demos');
    await openRemoteFolder(dialog, 'Krestage 3');
    await selectEntryCheckbox(dialog, 'Part 1.d64');
    await page.getByRole('button', { name: 'Add to playlist' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expectFtpTraceSequence(page, testInfo, (event) => {
      const data = event.data as { operation?: string; path?: string };
      return data.operation === 'list' && (data.path ?? '').includes('/Usb0');
    });

    const row = page.getByTestId('playlist-item').filter({ hasText: 'Part 1.d64' }).first();
    await row.getByRole('button', { name: 'Item actions' }).click();
    const sizeItem = page.getByRole('menuitem', { name: /Size:/i });
    const dateItem = page.getByRole('menuitem', { name: /Date:/i });
    await expect(sizeItem).toBeVisible();
    await expect(dateItem).toBeVisible();
    await expect(sizeItem).not.toContainText('—');
    await expect(dateItem).not.toContainText('—');
    await snap(page, testInfo, 'playlist-ftp-size-date');
  });

  test('playback headers removed and played label is prominent', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await expect(page.getByText('Playback controls')).toHaveCount(0);
    await expect(page.getByText('SID options')).toHaveCount(0);
    await expect(page.getByText('Current duration')).toHaveCount(0);
    await expect(page.getByTestId('playback-elapsed')).toBeVisible();
    await expect(page.getByTestId('playback-remaining')).toBeVisible();
    await snap(page, testInfo, 'headers-removed');
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
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 1'].value).not.toBe(initialState['Vol UltiSid 1'].value);
    await snap(page, testInfo, 'volume-updated');
  });

  test('pause mutes SID outputs and resume restores them', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const initialState = server.getState()['Audio Mixer'];
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await expect(page.getByTestId('playlist-item')).toHaveCount(1);

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

    await expect.poll(
      () => server.requests.some((req) => req.url.includes('/v1/machine:resume')),
      { timeout: 2000 },
    ).toBe(true);

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
        getPersistedUris: async () => ({ uris: [] as Array<{ uri: string }> }),
      };
    });

    await page.goto('/play');
    await snap(page, testInfo, 'playlist-empty');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await snap(page, testInfo, 'choose-source');

    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
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
        getPersistedUris: async () => ({ uris: [] as Array<{ uri: string }> }),
      };
    });

    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');

    const overlay = page.getByTestId('add-items-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.getByText('No supported files')).toHaveCount(0);
    await snap(page, testInfo, 'saf-scan-overlay');

    await expect(page.locator('[data-testid="add-items-overlay"]')).toHaveCount(0);
    await expect(page.getByRole('status').getByText('No supported files', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'saf-no-supported-files');
  });

  test('SAF scan failures are logged and do not crash the page', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings', description: 'Expected destructive toast for SAF scan failure.' });
    await page.addInitScript(() => {
      (window as Window & { __c64uPlatformOverride?: string }).__c64uPlatformOverride = 'android';
      (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride = true;

      const treeUri = 'content://tree/primary%3ABroken';
      const pickDirectory = async () => ({ treeUri, rootName: 'Broken', permissionPersisted: true });
      const listChildren = async ({ treeUri: requestUri }: { treeUri: string }) => {
        if (requestUri !== treeUri) throw new Error('Unexpected treeUri');
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { entries: { bad: true } } as any;
      };
      (window as Window & { __c64uFolderPickerOverride?: any }).__c64uFolderPickerOverride = {
        pickDirectory,
        listChildren,
        readFileFromTree: async () => ({ data: '' }),
        readFile: async () => ({ data: '' }),
        getPersistedUris: async () => ({ uris: [] as Array<{ uri: string }> }),
      };
    });

    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');

    const overlay = page.getByTestId('add-items-overlay');
    await expect(overlay).toBeVisible();
    await snap(page, testInfo, 'saf-error-overlay');

    await expect(page.locator('[data-testid="add-items-overlay"]')).toHaveCount(0);
    await expect(page.getByRole('status').getByText('Add items failed', { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const logs = await page.evaluate(() => JSON.parse(localStorage.getItem('c64u_app_logs') ?? '[]'));
      return logs.some((entry: { level: string; message: string }) => entry.level === 'error' && entry.message === 'PLAYLIST_ADD: Add items failed');
    }).toBe(true);

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await snap(page, testInfo, 'saf-error-recovered');
  });

  test('local browsing filters supported files and plays SID upload', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await snap(page, testInfo, 'add-items-open');
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-populated');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    const playlistList = page.getByTestId('playlist-list');
    await expect(playlistList.getByTestId('playlist-item-header').filter({ hasText: '/local-play/' })).toBeVisible();
    await expect(playlistList.getByText('/local-play/demo.sid')).toHaveCount(0);

    const resetBefore = server.requests.filter((req) => req.url.startsWith('/v1/machine:reset')).length;
    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.sid' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() => server.sidplayRequests.length > 0);
    expect(server.sidplayRequests[0].method).toBe('POST');
    await snap(page, testInfo, 'sid-playback-requested');

    const stopButton = page.getByTestId('playlist-play');
    await expect(stopButton).toHaveAttribute('aria-label', 'Stop');
    await snap(page, testInfo, 'sid-playing');
    await stopButton.click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/machine:reset')).length > resetBefore,
    );
    await snap(page, testInfo, 'sid-stop-reset');
  });

  test('songlengths metadata is applied for local SIDs', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths-documents')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await expect(page.getByTestId('playlist-list')).toContainText('demo2.sid');
    await snap(page, testInfo, 'songlengths-playlist');

    const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' });
    await demoRow.getByRole('button', { name: 'Item actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Duration: 0:20/ })).toBeVisible();
    await snap(page, testInfo, 'songlengths-duration');
  });

  test('remaining time label uses song length', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-songlengths-documents')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' });
    await demoRow.getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() => server.sidplayRequests.length > 0);

    const remaining = page.getByTestId('playback-remaining');
    await expect.poll(async () => {
      const text = await remaining.textContent();
      if (!text) return null;
      if (!text.startsWith('-')) return null;
      return parseTimeLabel(text.replace('-', ''));
    }).toBeGreaterThanOrEqual(19);
    await snap(page, testInfo, 'remaining-time-label');
  });

  test('hvsc md5 duration lookup updates playlist durations', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    const demoRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
    await demoRow.getByRole('button', { name: 'Play' }).click();
    await waitForRequests(() => server.sidplayRequests.length > 0);

    await demoRow.getByRole('button', { name: 'Item actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Duration: 0:42/ })).toBeVisible();
    await snap(page, testInfo, 'hvsc-md5-duration');
  });

  test('local source browser filters supported files', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'local-source-added');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await expect(page.getByText('demo.txt')).toHaveCount(0);
    await snap(page, testInfo, 'local-source-filtered');
  });

  test('folder play populates playlist dialog', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '1');
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-populated');
  });

  test('reshuffle changes playlist order and keeps current track index', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const playlistItems: Array<{
      source: 'ultimate';
      path: string;
      name: string;
      durationMs: number;
      songNr: number;
      sourceId: string | null;
    }> = [];

    for (let index = 0; index < 6; index += 1) {
      playlistItems.push({
        source: 'ultimate',
        path: `/Usb0/Demos/shuffle-${index}.sid`,
        name: `shuffle-${index}.sid`,
        durationMs: 5000,
        songNr: 1,
        sourceId: null,
      });
    }

    const playlist = {
      items: playlistItems,
      currentIndex: 0,
    };

    await page.addInitScript((payload: { items: Array<Record<string, unknown>>; currentIndex: number }) => {
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(payload));
      localStorage.setItem('c64u_playlist:v1:default', JSON.stringify(payload));
      localStorage.setItem('c64u_last_device_id', 'TEST-123');
    }, playlist);

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const shuffleCheckbox = page.getByTestId('playback-shuffle');
    await shuffleCheckbox.click();

    await page.getByTestId('playlist-play').click();
    await expect(page.getByTestId('playback-current-track')).toContainText('shuffle-0.sid');

    const getTitles = async () => {
      const rows = page.getByTestId('playlist-item');
      const count = await rows.count();
      const titles: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const row = rows.nth(i);
        const title = await row.locator('button span').first().textContent();
        if (title?.trim()) titles.push(title.trim());
      }
      return titles;
    };

    const beforeTitles = await getTitles();
    const currentTrack = 'shuffle-0.sid';
    const beforeIndex = beforeTitles.indexOf(currentTrack);

    await page.getByRole('button', { name: 'Reshuffle' }).click();
    await snap(page, testInfo, 'reshuffle-clicked');

    await expect.poll(async () => (await getTitles()).join('|')).not.toBe(beforeTitles.join('|'));
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play-unsupported')]);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('add-items-progress')).toContainText('No supported files');
    await snap(page, testInfo, 'no-supported-files');
  });

  test('ultimate browsing lists FTP entries and mounts remote disk image', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'C64 Ultimate');
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
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'C64 Ultimate');
    const dialog = page.getByRole('dialog');
    await ensureRemoteRoot(dialog);
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Games');
    await expect(dialog.getByText(/Path:\s*\/Usb0\/Games\/?/)).toBeVisible();
    await expect(dialog.getByText('/Usb0/Games/Turrican II')).toHaveCount(0);
    await snap(page, testInfo, 'c64u-path-remembered');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await snap(page, testInfo, 'dialog-closed');

    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'C64 Ultimate');
    await expect(page.getByText(/Path:\s*\/Usb0\/Games\/?/)).toBeVisible();
    await page.getByTestId('navigate-root').click();
    await expect(page.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
  });

  test('disk image triggers mount and autostart sequence', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');
    const rebootBefore = server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length;
    await page
      .getByTestId('playlist-item')
      .filter({ hasText: 'demo.d64' })
      .getByRole('button', { name: 'Play' })
      .click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length > rebootBefore,
    );
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

    const rebootAfterPlay = server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length;
    const stopButton = page.getByTestId('playlist-play');
    await expect(stopButton).toHaveAttribute('aria-label', 'Stop');
    await snap(page, testInfo, 'disk-playing');
    await stopButton.click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length > rebootAfterPlay,
    );
    await snap(page, testInfo, 'disk-stop-reboot');
  });

  test('demo mode disk image waits for keyboard buffer readiness', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected probe failures during demo mode.');
    await page.addInitScript(({ demoBaseUrl }) => {
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = demoBaseUrl;
      localStorage.setItem('c64u_startup_discovery_window_ms', '300');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_device_host', 'demo.invalid');
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
      sessionStorage.setItem('c64u_demo_interstitial_shown', '1');
    }, { demoBaseUrl: server.baseUrl });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    const demoButton = page.getByRole('button', { name: 'Continue in Demo Mode' });
    if (await demoButton.isVisible().catch(() => false)) {
      await demoButton.click();
      await expect(page.getByRole('dialog', { name: 'Demo Mode' })).toBeHidden();
    }

    const dismissDemoDialog = async () => {
      const demoDialog = page.getByRole('dialog', { name: 'Demo Mode' });
      if (await demoDialog.isVisible().catch(() => false)) {
        await demoDialog.getByRole('button', { name: 'Continue in Demo Mode' }).click();
        await expect(demoDialog).toBeHidden();
      }
    };

    const dismissBlockingDialogs = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await dismissDemoDialog();
        const stillVisible = await page.getByRole('dialog', { name: 'Demo Mode' }).isVisible().catch(() => false);
        if (!stillVisible) break;
      }
    };

    await dismissBlockingDialogs();
    await openAddItemsDialog(page);
    const addDialog = page.getByRole('dialog').filter({ has: page.getByText('Add items') });
    await dismissBlockingDialogs();
    await expect(page.getByRole('dialog', { name: 'Demo Mode' })).toBeHidden();
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device', { force: true });
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    const input = page.locator('input[type="file"][webkitdirectory]');
    const tempDir = createTempDiskDirectory();
    try {
      await input.setInputFiles(tempDir);
      await expect(addDialog).toBeHidden();
      const lingeringDialog = page.getByRole('dialog');
      if (await lingeringDialog.isVisible().catch(() => false)) {
        const cancelButton = lingeringDialog.getByRole('button', { name: 'Cancel' });
        if (await cancelButton.isVisible().catch(() => false)) {
          await cancelButton.click();
          await expect(lingeringDialog).toBeHidden();
        }
        if (await lingeringDialog.isVisible().catch(() => false)) {
          await page.keyboard.press('Escape');
          await expect(lingeringDialog).toBeHidden();
        }
      }
      await expect(page.locator('[data-testid="add-items-overlay"]')).toHaveCount(0);
      const playlistItem = page.getByTestId('playlist-item').filter({ hasText: 'demo.d64' }).first();
      await expect(playlistItem).toBeVisible();
      await page.getByTestId('playlist-play').click({ force: true });

      await waitForRequests(() =>
        server.requests.some((req) => req.url.startsWith('/v1/machine:writemem')),
      );
      await expect(page.getByText(/Keyboard buffer remained busy/i)).toHaveCount(0);
      await snap(page, testInfo, 'demo-autostart');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('disk image uses DMA autostart when enabled', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await page.addInitScript(() => {
      localStorage.setItem('c64u_disk_autostart_mode', 'dma');
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    const tempDir = createTempDiskDirectory();
    try {
      await input.setInputFiles(tempDir);
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
        server.requests.some((req) => req.method === 'POST' && req.url.startsWith('/v1/machine:writemem')),
      );
      await snap(page, testInfo, 'dma-autostart-complete');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('volume slider updates enabled SID volumes and restores after mute', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.request.post(`${server.baseUrl}/v1/configs`, {
      data: {
        'SID Sockets Configuration': {
          'SID Socket 1': 'Enabled',
          'SID Socket 2': 'Disabled',
        },
        'SID Addressing': {
          'UltiSID 1 Address': 'Unmapped',
          'UltiSID 2 Address': '$D420',
        },
      },
    });

    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    const slider = page.getByTestId('volume-slider');
    const muteButton = page.getByTestId('volume-mute');
    const volumeLabel = page.getByTestId('volume-label');
    await expect(slider).toBeVisible();
    await expect(muteButton).toBeVisible();

    const initialState = server.getState()['Audio Mixer'];
    const initialSocket1 = initialState['Vol Socket 1']?.value;
    const initialUlti2 = initialState['Vol UltiSid 2']?.value;
    const initialSocket2 = initialState['Vol Socket 2']?.value;
    const initialUlti1 = initialState['Vol UltiSid 1']?.value;
    const initialUpdateCount = server.requests.filter(
      (req) => req.method === 'POST' && req.url.startsWith('/v1/configs'),
    ).length;
    const box = await slider.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
      await page.mouse.up();
    }

    await waitForRequests(() =>
      server.requests.filter((req) => req.method === 'POST' && req.url.startsWith('/v1/configs')).length > initialUpdateCount,
    );

    const updatedState = server.getState()['Audio Mixer'];
    const target = updatedState['Vol Socket 1']?.value;
    expect(target).toBeDefined();
    expect(updatedState['Vol UltiSid 2']?.value).toBe(target);
    expect(updatedState['Vol Socket 1']?.value).not.toBe(initialSocket1);
    expect(updatedState['Vol UltiSid 2']?.value).not.toBe(initialUlti2);
    expect(updatedState['Vol Socket 2']?.value).toBe(initialSocket2);
    expect(updatedState['Vol UltiSid 1']?.value).toBe(initialUlti1);

    const muteUpdateCount = server.requests.filter(
      (req) => req.method === 'POST' && req.url.startsWith('/v1/configs'),
    ).length;
    await muteButton.click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.method === 'POST' && req.url.startsWith('/v1/configs')).length > muteUpdateCount,
    );
    await expect(slider).not.toHaveAttribute('data-disabled');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1']?.value).toBe('OFF');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2']?.value).toBe('OFF');
    const mutedState = server.getState()['Audio Mixer'];
    expect(mutedState['Vol Socket 2']?.value).toBe(initialSocket2);
    expect(mutedState['Vol UltiSid 1']?.value).toBe(initialUlti1);

    const boxMuted = await slider.boundingBox();
    expect(boxMuted).not.toBeNull();
    if (boxMuted) {
      await page.mouse.move(boxMuted.x + 4, boxMuted.y + boxMuted.height / 2);
      await page.mouse.down();
      await page.mouse.move(boxMuted.x + boxMuted.width - 4, boxMuted.y + boxMuted.height / 2);
      await page.mouse.up();
    }
    const mutedStateAfterSlider = server.getState()['Audio Mixer'];
    expect(mutedStateAfterSlider['Vol Socket 1']?.value).toBe('OFF');
    expect(mutedStateAfterSlider['Vol UltiSid 2']?.value).toBe('OFF');

    const unmuteUpdateCount = server.requests.filter(
      (req) => req.method === 'POST' && req.url.startsWith('/v1/configs'),
    ).length;
    await muteButton.click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.method === 'POST' && req.url.startsWith('/v1/configs')).length > unmuteUpdateCount,
    );
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1']?.value).not.toBe('OFF');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2']?.value).not.toBe('OFF');
    const unmutedState = server.getState()['Audio Mixer'];
    const updatedTarget = unmutedState['Vol Socket 1']?.value;
    expect(updatedTarget).toBeDefined();
    expect(unmutedState['Vol UltiSid 2']?.value).toBe(updatedTarget);
    expect(unmutedState['Vol Socket 2']?.value).toBe(initialSocket2);
    expect(unmutedState['Vol UltiSid 1']?.value).toBe(initialUlti1);

    await snap(page, testInfo, 'volume-updated');
  });

  test('volume slider reports min/max bounds', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.request.post(`${server.baseUrl}/v1/configs`, {
      data: {
        'SID Sockets Configuration': {
          'SID Socket 1': 'Enabled',
          'SID Socket 2': 'Enabled',
        },
        'SID Addressing': {
          'UltiSID 1 Address': '$D400',
          'UltiSID 2 Address': '$D420',
        },
      },
    });

    await page.goto('/play');
    await expect(page.getByText('Connected')).toBeVisible();
    const slider = page.getByTestId('volume-slider');
    const label = page.getByTestId('volume-label');
    await expect(slider).toBeVisible();
    await expect(slider).not.toHaveAttribute('data-disabled');
    await expect(page.getByTestId('volume-mute')).toBeEnabled();

    const thumb = slider.getByRole('slider');
    await expect(thumb).toBeEnabled();
    const min = await thumb.getAttribute('aria-valuemin');
    const max = await thumb.getAttribute('aria-valuemax');
    expect(min).not.toBeNull();
    expect(max).not.toBeNull();

    const bounds = await slider.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    const current = await thumb.getAttribute('aria-valuenow');
    const minValue = Number(min);
    const maxValue = Number(max);
    const currentValue = Number(current);
    expect(Number.isNaN(minValue)).toBe(false);
    expect(Number.isNaN(maxValue)).toBe(false);
    expect(Number.isNaN(currentValue)).toBe(false);
    expect(currentValue).toBeGreaterThanOrEqual(minValue);
    expect(currentValue).toBeLessThanOrEqual(maxValue);
    await expect(label).not.toHaveText('—');

    await snap(page, testInfo, 'volume-bounds');
  });

  test('reshuffle button does not stick', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByTestId('playback-shuffle').click();
    const reshuffle = page.getByTestId('playlist-reshuffle');
    await expect(reshuffle).toBeEnabled();
    await reshuffle.click();
    await expect(reshuffle).toHaveAttribute('data-active', 'true');
    await expect.poll(async () => reshuffle.getAttribute('data-active')).toBe('false');
    await snap(page, testInfo, 'reshuffle-momentary');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'C64 Ultimate');
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

    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'C64 Ultimate');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await expect.poll(() => server.sidplayRequests.length).toBe(0);
    await snap(page, testInfo, 'no-autoplay');
  });

  test('prev/next navigates within playlist', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableGoldenTrace(testInfo);
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'playlist-ready');

    const rebootStart = server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length;
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
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length > rebootStart,
    );
    await waitForRequests(() => server.sidplayRequests.length > 0);
    await snap(page, testInfo, 'next-track-playing');

    const rebootAfterNext = server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length;
    await page.getByTestId('playlist-prev').click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/drives/a:mount')).length > 1,
    );
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length > rebootAfterNext,
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
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
    await expect(playButton).toHaveAttribute('aria-label', 'Stop');
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect(pauseButton).toHaveAttribute('aria-label', 'Resume');
    await snap(page, testInfo, 'paused');
    await playButton.click();
    await expect(playButton).toHaveAttribute('aria-label', 'Play');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-saved');

    await page.reload();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-restored');
  });

  test('playlist persists across navigation', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await openAddItemsDialog(page);
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
    const input = page.locator('input[type="file"][webkitdirectory]');
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-before-navigation');

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await page.goto('/play');
    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-after-navigation');
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
    await clickSourceSelectionButton(page.getByRole('dialog'), 'This device');
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
