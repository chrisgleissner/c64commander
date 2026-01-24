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
  const row = container.getByText(name, { exact: true }).locator('..').locator('..').locator('..');
  await row.getByRole('button', { name: 'Open' }).click();
};

const ensureRemoteRoot = async (container: Page | Locator) => {
  const rootButton = container.getByTestId('navigate-root');
  const visible = await rootButton.isVisible().catch(() => false);
  if (!visible) return;
  // Avoid flakiness: during navigation the button can briefly flip enabled/disabled.
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
  }, { seedItems: items });
};

const buildAlphabetPlaylist = () =>
  Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(65 + index);
    return {
      source: 'ultimate' as const,
      path: `/Usb0/Alphabet/${letter}-Track-001.sid`,
      name: `${letter}-Track-001.sid`,
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

    const scrollArea = page.getByTestId('action-list-scroll');
    const scrollable = await scrollArea.evaluate((node: HTMLElement) => node.scrollHeight > node.clientHeight);
    expect(scrollable).toBeTruthy();

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
    await expect(page.getByTestId('action-list-scroll')).toContainText('Gamma.sid');
    await expect(page.getByTestId('action-list-scroll')).not.toContainText('Alpha.sid');
  });

  test('alphabet overlay does not affect list metrics', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    await seedPlaylistStorage(page, buildAlphabetPlaylist());

    await page.goto('/play');
    await page.getByRole('button', { name: 'View all' }).click();

    const scrollArea = page.getByTestId('action-list-scroll');
    const initialMetrics = await scrollArea.evaluate((node: HTMLElement) => ({
      width: node.clientWidth,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));

    await scrollArea.evaluate((node: HTMLElement) => {
      node.scrollTop = node.scrollHeight / 2;
    });
    await expect.poll(async () => {
      const opacity = await page.getByTestId('alphabet-overlay').evaluate((node: HTMLElement) =>
        Number(window.getComputedStyle(node).opacity),
      );
      return opacity;
    }).toBeGreaterThan(0.8);

    const afterMetrics = await scrollArea.evaluate((node: HTMLElement) => ({
      width: node.clientWidth,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));

    expect(afterMetrics).toEqual(initialMetrics);
    await snap(page, testInfo, 'alphabet-overlay-metrics');
  });

  test('alphabet overlay jumps to selected letter and auto-hides', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '5');
    });
    await seedPlaylistStorage(page, buildAlphabetPlaylist());

    await page.goto('/play');
    await page.getByRole('button', { name: 'View all' }).click();

    const touchArea = page.getByTestId('alphabet-touch-area');
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
    await expect(page.getByText('Z-Track-001.sid', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'alphabet-jump');

    await page.waitForTimeout(1700);
    const overlayOpacity = await page.getByTestId('alphabet-overlay').evaluate((node: HTMLElement) =>
      window.getComputedStyle(node).opacity,
    );
    expect(Number(overlayOpacity)).toBeLessThan(0.2);
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
    const playedLabel = page.getByTestId('playback-played');
    await expect(counters).toContainText('Total: 0:12');
    await expect(playedLabel).toContainText('Played: 0:00');

    await page.getByTestId('playlist-play').click();
    await page.waitForTimeout(1200);
    await snap(page, testInfo, 'playback-running');

    await expect.poll(async () => {
      const text = await playedLabel.textContent();
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

  test('stop does not auto-resume playback', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    const playButton = page.getByTestId('playlist-play');
    await playButton.click();
    await expect(playButton).toContainText('Stop');
    await snap(page, testInfo, 'play-started');

    await playButton.click();
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'play-stopped');

    await page.waitForTimeout(12000);
    await expect(playButton).toContainText('Play');
    await snap(page, testInfo, 'no-autoresume');
  });

  test('played time advances steadily while playing', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 8000 },
    ]);

    await page.goto('/play');
    const playButton = page.getByTestId('playlist-play');
    const played = page.getByTestId('playback-played');
    await playButton.click();
    await snap(page, testInfo, 'play-started');

    await page.waitForTimeout(1200);
    const firstValue = parseTimeLabel(await played.textContent());
    await page.waitForTimeout(1200);
    const secondValue = parseTimeLabel(await played.textContent());

    expect(firstValue ?? 0).toBeGreaterThanOrEqual(1);
    expect(secondValue ?? 0).toBeGreaterThan(firstValue ?? 0);
    expect(secondValue ?? 0).toBeLessThanOrEqual(5);
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

  test('mute button toggles and slider unmutes', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    await expect(muteButton).toContainText('Mute');
    await snap(page, testInfo, 'slider-unmuted');
  });

  test('file type filters hide disabled categories', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_list_preview_limit', '1');
    });
    await seedPlaylistStorage(page, [
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.sid', name: 'demo.sid', durationMs: 4000 },
      { source: 'ultimate' as const, path: '/Usb0/Demos/demo.prg', name: 'demo.prg', durationMs: 4000 },
    ]);

    await page.goto('/play');
    const list = page.getByTestId('playlist-list');
    await expect(list).toContainText('demo.sid');

    await expect(page.getByRole('button', { name: 'View all' })).toBeVisible();
    await page.getByRole('button', { name: 'View all' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('SID', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByTestId('file-type-filter-sid').click();
    await snap(page, testInfo, 'sid-disabled');
    await expect(list).not.toContainText('demo.sid');
    await expect(list).toContainText('demo.prg');

    await snap(page, testInfo, 'filters-in-view-all');
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
    await expect(list).toContainText('(0:30)');
    await snap(page, testInfo, 'songlengths-loaded');
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
    await page.goto('/play');
    await openAddItemsDialog(page);
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await openRemoteFolder(dialog, 'Usb0');
    await openRemoteFolder(dialog, 'Demos');
    await openRemoteFolder(dialog, 'Krestage 3');
    await selectEntryCheckbox(dialog, 'Part 1.d64');
    await page.getByRole('button', { name: 'Add to playlist' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

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
    await expect(page.getByTestId('playback-played')).toContainText('Played:');
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
      return logs.some((entry: { level: string; message: string }) => entry.level === 'error' && entry.message === 'Add items failed');
    }).toBe(true);

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await snap(page, testInfo, 'saf-error-recovered');
  });

  test('local browsing filters supported files and plays SID upload', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    await expect(stopButton).toContainText('Stop');
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
    await expect(stopButton).toContainText('Stop');
    await snap(page, testInfo, 'disk-playing');
    await stopButton.click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.url.startsWith('/v1/machine:reboot')).length > rebootAfterPlay,
    );
    await snap(page, testInfo, 'disk-stop-reboot');
  });

  test('disk image uses DMA autostart when enabled', async ({ page }: { page: Page }, testInfo: TestInfo) => {
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
    const mutedState = server.getState()['Audio Mixer'];
    expect(mutedState['Vol Socket 1']?.value).toBe('OFF');
    expect(mutedState['Vol UltiSid 2']?.value).toBe('OFF');
    expect(mutedState['Vol Socket 2']?.value).toBe(initialSocket2);
    expect(mutedState['Vol UltiSid 1']?.value).toBe(initialUlti1);

    const unmuteUpdateCount = server.requests.filter(
      (req) => req.method === 'POST' && req.url.startsWith('/v1/configs'),
    ).length;
    await muteButton.click();
    await waitForRequests(() =>
      server.requests.filter((req) => req.method === 'POST' && req.url.startsWith('/v1/configs')).length > unmuteUpdateCount,
    );
    const unmutedState = server.getState()['Audio Mixer'];
    expect(unmutedState['Vol Socket 1']?.value).toBe(target);
    expect(unmutedState['Vol UltiSid 2']?.value).toBe(target);
    expect(unmutedState['Vol Socket 2']?.value).toBe(initialSocket2);
    expect(unmutedState['Vol UltiSid 1']?.value).toBe(initialUlti1);

    await snap(page, testInfo, 'volume-updated');
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
