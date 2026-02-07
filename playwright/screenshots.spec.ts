import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
// Load full YAML config for tests
import '../tests/mocks/setupMockConfigForTests';
import { seedUiMocks } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import {
  allowVisualOverflow,
  assertNoUiIssues,
  attachStepScreenshot,
  finalizeEvidence,
  startStrictUiMonitoring,
} from './testArtifacts';
import { disableTraceAssertions } from './traceUtils';
import type { TraceEvent } from '../src/lib/tracing/types';
import { registerScreenshotSections, sanitizeSegment } from './screenshotCatalog';

const SCREENSHOT_ROOT = path.resolve('doc/img/app');
const FIXED_NOW_ISO = '2024-03-20T12:34:56.000Z';
const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

const DISK_LIBRARY_SEED = [
  {
    id: 'ultimate:/Usb0/Games/Turrican II/Disk 1.d64',
    name: 'Disk 1.d64',
    path: '/Usb0/Games/Turrican II/Disk 1.d64',
    location: 'ultimate',
    group: 'Turrican II',
    sizeBytes: 174848,
    modifiedAt: '2024-03-10T10:00:00.000Z',
    importedAt: '2024-03-12T09:00:00.000Z',
    importOrder: 1,
  },
  {
    id: 'ultimate:/Usb0/Games/Turrican II/Disk 2.d64',
    name: 'Disk 2.d64',
    path: '/Usb0/Games/Turrican II/Disk 2.d64',
    location: 'ultimate',
    group: 'Turrican II',
    sizeBytes: 174848,
    modifiedAt: '2024-03-10T10:05:00.000Z',
    importedAt: '2024-03-12T09:01:00.000Z',
    importOrder: 2,
  },
  {
    id: 'ultimate:/Usb0/Games/Turrican II/Disk 3.d64',
    name: 'Disk 3.d64',
    path: '/Usb0/Games/Turrican II/Disk 3.d64',
    location: 'ultimate',
    group: 'Turrican II',
    sizeBytes: 174848,
    modifiedAt: '2024-03-10T10:10:00.000Z',
    importedAt: '2024-03-12T09:02:00.000Z',
    importOrder: 3,
  },
  {
    id: 'ultimate:/Usb0/Games/Last Ninja/Disk 1.d64',
    name: 'Disk 1.d64',
    path: '/Usb0/Games/Last Ninja/Disk 1.d64',
    location: 'ultimate',
    group: 'Last Ninja',
    sizeBytes: 174848,
    modifiedAt: '2024-03-11T08:15:00.000Z',
    importedAt: '2024-03-12T09:03:00.000Z',
    importOrder: 1,
  },
  {
    id: 'local:/Local/Disks/Defender of the Crown.d64',
    name: 'Defender of the Crown.d64',
    path: '/Local/Disks/Defender of the Crown.d64',
    location: 'local',
    group: null,
    sizeBytes: 174848,
    modifiedAt: '2024-03-11T09:00:00.000Z',
    importedAt: '2024-03-12T09:04:00.000Z',
    importOrder: 4,
  },
  {
    id: 'local:/Local/Disks/Great Giana Sisters.d64',
    name: 'Great Giana Sisters.d64',
    path: '/Local/Disks/Great Giana Sisters.d64',
    location: 'local',
    group: null,
    sizeBytes: 174848,
    modifiedAt: '2024-03-11T09:30:00.000Z',
    importedAt: '2024-03-12T09:05:00.000Z',
    importOrder: 5,
  },
];

const PLAYLIST_SEED = {
  items: [
    {
      source: 'local',
      path: '/Local/Demos/intro.sid',
      name: 'intro.sid',
      durationMs: 185000,
      sizeBytes: 32145,
      modifiedAt: '2024-03-18T09:12:00.000Z',
      addedAt: '2024-03-18T09:30:00.000Z',
    },
    {
      source: 'local',
      path: '/Local/Demos/scene.mod',
      name: 'scene.mod',
      durationMs: 210000,
      sizeBytes: 54231,
      modifiedAt: '2024-03-18T10:15:00.000Z',
      addedAt: '2024-03-18T10:20:00.000Z',
    },
    {
      source: 'local',
      path: '/Local/Tools/fastload.prg',
      name: 'fastload.prg',
      durationMs: 60000,
      sizeBytes: 1048,
      modifiedAt: '2024-03-18T11:00:00.000Z',
      addedAt: '2024-03-18T11:05:00.000Z',
    },
    {
      source: 'ultimate',
      path: '/Usb0/Games/SpaceTaxi.d64',
      name: 'SpaceTaxi.d64',
      durationMs: 300000,
      sizeBytes: 174848,
      modifiedAt: '2024-03-19T08:05:00.000Z',
      addedAt: '2024-03-19T08:10:00.000Z',
    },
    {
      source: 'ultimate',
      path: '/Usb0/Cartridges/ActionReplay.crt',
      name: 'ActionReplay.crt',
      durationMs: 120000,
      sizeBytes: 65536,
      modifiedAt: '2024-03-19T09:00:00.000Z',
      addedAt: '2024-03-19T09:05:00.000Z',
    },
  ],
  currentIndex: 1,
};

const LOG_SEED = [
  {
    id: 'log-1',
    level: 'info',
    message: 'Config refresh complete',
    timestamp: '2024-03-20T11:58:20.000Z',
    details: { endpoint: '/v1/configs', durationMs: 180 },
  },
  {
    id: 'log-2',
    level: 'warn',
    message: 'Background probe slow',
    timestamp: '2024-03-20T11:59:10.000Z',
    details: { timeoutMs: 1200 },
  },
  {
    id: 'log-3',
    level: 'error',
    message: 'Disk mount failed',
    timestamp: '2024-03-20T12:00:05.000Z',
    details: { drive: 'A', reason: 'Disk not found' },
  },
];

const TRACE_SEED: TraceEvent[] = [
  {
    id: 'TRACE-1000',
    timestamp: '2024-03-20T12:00:00.000Z',
    relativeMs: 0,
    type: 'action-start',
    origin: 'user',
    correlationId: 'COR-1000',
    data: { name: 'playlist.add' },
  },
  {
    id: 'TRACE-1001',
    timestamp: '2024-03-20T12:00:00.050Z',
    relativeMs: 50,
    type: 'rest-request',
    origin: 'user',
    correlationId: 'COR-1000',
    data: { method: 'GET', url: '/v1/info', normalizedUrl: '/v1/info', target: 'real-device' },
  },
  {
    id: 'TRACE-1002',
    timestamp: '2024-03-20T12:00:00.120Z',
    relativeMs: 120,
    type: 'rest-response',
    origin: 'user',
    correlationId: 'COR-1000',
    data: { status: 200, durationMs: 70, error: null },
  },
  {
    id: 'TRACE-1003',
    timestamp: '2024-03-20T12:00:00.220Z',
    relativeMs: 220,
    type: 'ftp-operation',
    origin: 'user',
    correlationId: 'COR-1000',
    data: { operation: 'list', path: '/Usb0', result: 'success', target: 'real-device' },
  },
  {
    id: 'TRACE-1004',
    timestamp: '2024-03-20T12:00:00.260Z',
    relativeMs: 260,
    type: 'error',
    origin: 'user',
    correlationId: 'COR-1000',
    data: { name: 'Error', message: 'Packet timeout' },
  },
  {
    id: 'TRACE-1005',
    timestamp: '2024-03-20T12:00:00.320Z',
    relativeMs: 320,
    type: 'action-end',
    origin: 'user',
    correlationId: 'COR-1000',
    data: { status: 'success', error: null },
  },
];

const HVSC_STATUS_SUMMARY = {
  download: { status: 'idle' },
  extraction: { status: 'idle' },
  lastUpdatedAt: null,
};

const screenshotPath = (relativePath: string) => path.resolve(SCREENSHOT_ROOT, relativePath);

const screenshotLabel = (relativePath: string) =>
  relativePath.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '-');

const ensureScreenshotDir = async (filePath: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const waitForStableRender = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => (document as any).fonts?.ready ?? true);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

const waitForOverlaysToClear = async (page: Page) => {
  const notificationRegion = page.locator('[aria-label="Notifications (F8)"]');
  const openToasts = notificationRegion.locator('[data-state="open"], [role="status"]');
  await expect(openToasts).toHaveCount(0, { timeout: 10000 });
};

const captureScreenshot = async (page: Page, testInfo: TestInfo, relativePath: string) => {
  const filePath = screenshotPath(relativePath);
  await ensureScreenshotDir(filePath);
  await waitForStableRender(page);
  await waitForOverlaysToClear(page);
  await page.screenshot({ path: filePath, animations: 'disabled', caret: 'hide' });
  await attachStepScreenshot(page, testInfo, screenshotLabel(relativePath));
};

const scrollAndCapture = async (page: Page, testInfo: TestInfo, locator: ReturnType<Page['locator']>, relativePath: string) => {
  await locator.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, relativePath);
};

const scrollHeadingIntoView = async (page: Page, locator: ReturnType<Page['locator']>) => {
  await locator.scrollIntoViewIfNeeded();
  const offset = await page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-bar-height');
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  if (offset > 0) {
    await page.evaluate((value) => window.scrollBy(0, -value - 8), offset);
  }
};

const capturePageSections = async (page: Page, testInfo: TestInfo, pageId: string) => {
  const headings = page.locator('main h2, main h3, main h4');
  const count = await headings.count();
  if (count === 0) return;

  const headingData: Array<{ text: string; locator: ReturnType<Page['locator']> }> = [];
  for (let index = 0; index < count; index += 1) {
    const locator = headings.nth(index);
    const text = (await locator.innerText()).trim();
    if (!text) continue;
    headingData.push({ text, locator });
  }

  const slugs = headingData.map((entry) => sanitizeSegment(entry.text));
  const orderMap = await registerScreenshotSections(pageId, slugs);

  for (let index = 0; index < headingData.length; index += 1) {
    const entry = headingData[index];
    const slug = sanitizeSegment(entry.text);
    const order = orderMap.get(slug) ?? index + 1;
    await scrollHeadingIntoView(page, entry.locator);
    await captureScreenshot(page, testInfo, `${pageId}/sections/${String(order).padStart(2, '0')}-${slug}.png`);
  }
};

const captureDocsSections = async (page: Page, testInfo: TestInfo) => {
  const sectionButtons = page.locator('main button').filter({ hasText: /^[A-Za-z]/ });
  const count = await sectionButtons.count();
  if (count === 0) return;
  const slugs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = (await sectionButtons.nth(index).innerText()).split('\n')[0]?.trim() ?? '';
    if (label) slugs.push(sanitizeSegment(label));
  }
  const orderMap = await registerScreenshotSections('docs', slugs);
  for (let index = 0; index < count; index += 1) {
    const button = sectionButtons.nth(index);
    const label = (await button.innerText()).split('\n')[0]?.trim() ?? '';
    if (!label) continue;
    const slug = sanitizeSegment(label);
    const order = orderMap.get(slug) ?? index + 1;
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await page.waitForTimeout(150);
    await captureScreenshot(page, testInfo, `docs/sections/${String(order).padStart(2, '0')}-${slug}.png`);
    await button.click();
    await page.waitForTimeout(100);
  }
};

const captureConfigSections = async (page: Page, testInfo: TestInfo) => {
  const toggles = page.locator('[data-testid^="config-category-"]');
  const count = await toggles.count();
  if (count === 0) return;
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = (await toggles.nth(index).innerText()).split('\n')[0]?.trim() ?? '';
    if (label) labels.push(sanitizeSegment(label));
  }
  const orderMap = await registerScreenshotSections('config', labels);
  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    const label = (await toggle.innerText()).split('\n')[0]?.trim() ?? '';
    if (!label) continue;
    const slug = sanitizeSegment(label);
    const order = orderMap.get(slug) ?? index + 1;
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await page.waitForTimeout(150);
    await captureScreenshot(page, testInfo, `config/sections/${String(order).padStart(2, '0')}-${slug}.png`);
    await toggle.click();
    await page.waitForTimeout(100);
  }
};

const captureLabeledSections = async (page: Page, testInfo: TestInfo, pageId: string) => {
  const sections = page.locator('main [data-section-label]');
  const count = await sections.count();
  if (count === 0) return;
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = (await sections.nth(index).getAttribute('data-section-label'))?.trim() ?? '';
    if (label) labels.push(sanitizeSegment(label));
  }
  const orderMap = await registerScreenshotSections(pageId, labels);
  for (let index = 0; index < count; index += 1) {
    const section = sections.nth(index);
    const label = (await section.getAttribute('data-section-label'))?.trim() ?? '';
    if (!label) continue;
    const slug = sanitizeSegment(label);
    const order = orderMap.get(slug) ?? index + 1;
    await scrollHeadingIntoView(page, section);
    await captureScreenshot(page, testInfo, `${pageId}/sections/${String(order).padStart(2, '0')}-${slug}.png`);
  }
};

const installFixedClock = async (page: Page) => {
  await page.addInitScript(({ nowMs }) => {
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        if (args.length === 0) {
          super(nowMs);
        } else {
          super(...args);
        }
      }
      static now() {
        return nowMs;
      }
    }
    FixedDate.UTC = OriginalDate.UTC;
    FixedDate.parse = OriginalDate.parse;
    window.Date = FixedDate as DateConstructor;
  }, { nowMs: FIXED_NOW_MS });
};

const installStableStorage = async (page: Page) => {
  await page.addInitScript(
    ({ playlist, disks, logs, hvscSummary, fixedNowIso }) => {
      localStorage.setItem('c64u_playlist:v1:TEST-123', JSON.stringify(playlist));
      localStorage.setItem('c64u_playlist:v1:default', JSON.stringify(playlist));
      localStorage.setItem('c64u_last_device_id', 'TEST-123');
      localStorage.setItem('c64u_disk_library:TEST-123', JSON.stringify({ disks }));
      localStorage.setItem('c64u_app_logs', JSON.stringify(logs));
      localStorage.setItem('c64u_hvsc_status:v1', JSON.stringify(hvscSummary));
      localStorage.setItem('c64u_feature_flag:hvsc_enabled', '1');
      sessionStorage.setItem('c64u_feature_flag:hvsc_enabled', '1');
      localStorage.setItem('c64u_demo_clock', fixedNowIso);
    },
    {
      playlist: PLAYLIST_SEED,
      disks: DISK_LIBRARY_SEED,
      logs: LOG_SEED,
      hvscSummary: HVSC_STATUS_SUMMARY,
      fixedNowIso: FIXED_NOW_ISO,
    },
  );
};

const installLocalSourceSeed = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('c64u_local_sources:v1', JSON.stringify([
      {
        id: 'seed-local-source',
        name: 'Seed Local',
        rootName: 'Local',
        rootPath: '/Local/',
        createdAt: '2024-03-20T12:00:00.000Z',
        entries: [
          {
            name: 'seed.sid',
            relativePath: 'Local/seed.sid',
            sizeBytes: 1024,
            modifiedAt: '2024-03-20T12:00:00.000Z',
          },
        ],
      },
    ]));
  });
};

const installListPreviewLimit = async (page: Page, limit: number) => {
  await page.addInitScript(({ listLimit }) => {
    localStorage.setItem('c64u_list_preview_limit', String(listLimit));
  }, { listLimit: limit });
};

const seedDiagnosticsTraces = async (page: Page) => {
  await page.evaluate((seed) => {
    const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void } }).__c64uTracing;
    tracing?.seedTraces?.(seed as TraceEvent[]);
  }, TRACE_SEED);
};

test.describe('App screenshots', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  test.beforeAll(async () => {
    // Use default YAML config (no initial state) to show all categories
    ftpServers = await startFtpTestServers();
    server = await createMockC64Server();
  });

  test.afterAll(async () => {
    await ftpServers.close();
    await server.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    disableTraceAssertions(testInfo, 'Visual-only screenshots; trace assertions disabled.');
    await startStrictUiMonitoring(page, testInfo);
    await installFixedClock(page);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await seedUiMocks(page, server.baseUrl);
    await installStableStorage(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
    }
  });

  test('capture home screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Disks', exact: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, 'home/00-overview-light.png');
    await capturePageSections(page, testInfo, 'home');

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await captureScreenshot(page, testInfo, 'home/01-overview-dark.png');
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  });

  test('capture home interaction screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/');

    await page.getByTestId('home-stream-toggle-audio').click();
    await scrollAndCapture(page, testInfo, page.getByTestId('home-stream-status'), 'home/interactions/01-toggle.png');

    await page.getByTestId('home-drive-type-a').click();
    await captureScreenshot(page, testInfo, 'home/interactions/02-dropdown.png');
    await page.keyboard.press('Escape');

    await page.getByTestId('home-stream-edit-toggle-vic').click();
    const streamInput = page.getByTestId('home-stream-ip-vic');
    await streamInput.click();
    await streamInput.fill('239.0.1.90');
    await scrollAndCapture(page, testInfo, page.getByTestId('home-stream-status'), 'home/interactions/03-input.png');
    await page.getByTestId('home-stream-confirm-vic').click();

    await page.getByTestId('home-sid-status').getByRole('button', { name: 'Reset' }).click();
    await expect.poll(() =>
      server.requests.filter((req) => req.method === 'PUT' && req.url.startsWith('/v1/machine:writemem')).length,
    ).toBeGreaterThan(0);
    await scrollAndCapture(page, testInfo, page.getByTestId('home-sid-status'), 'home/sid/01-reset-post-silence.png');
  });

  test('capture disks screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installListPreviewLimit(page, 3);
    await page.goto('/disks');
    await expect(page.getByRole('heading', { name: 'Disks', level: 1 })).toBeVisible();
    await expect(page.getByTestId('disk-list')).toContainText('Disk 1.d64');

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, 'disks/01-overview.png');
    await capturePageSections(page, testInfo, 'disks');

    const viewAllButton = page.getByRole('button', { name: 'View all' });
    await expect(viewAllButton).toBeVisible();
    await viewAllButton.click();
    await expect(page.getByTestId('action-list-view-all')).toBeVisible();
    await captureScreenshot(page, testInfo, 'disks/collection/01-view-all.png');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('action-list-view-all')).toBeHidden();
  });

  test('capture configuration screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, 'Audio mixer controls overflow on narrow screenshot viewport.');
    await page.goto('/config');
    await expect(page.getByRole('heading', { name: 'Config' })).toBeVisible();
    await expect.poll(async () => page.locator('[data-testid^="config-category-"]').count()).toBeGreaterThan(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, 'config/01-categories.png');
    await captureConfigSections(page, testInfo);
  });

  test('capture play screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installListPreviewLimit(page, 3);
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await expect(page.getByTestId('playlist-list')).toContainText('intro.sid');

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, 'play/01-overview.png');
    await captureLabeledSections(page, testInfo, 'play');

    const viewAllButton = page.getByRole('button', { name: 'View all' });
    await expect(viewAllButton).toBeVisible();
    await viewAllButton.click();
    await expect(page.getByTestId('action-list-view-all')).toBeVisible();
    await captureScreenshot(page, testInfo, 'play/playlist/01-view-all.png');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('action-list-view-all')).toBeHidden();

    await expect(page.getByTestId('hvsc-controls')).toBeVisible();
  });

  test('capture import flow screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await installLocalSourceSeed(page);
    await page.goto('/play');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('import-selection-interstitial')).toBeVisible();
    await captureScreenshot(page, testInfo, 'play/import/01-import-interstitial.png');

    await dialog.getByTestId('import-option-c64u').click();
    await expect(dialog.getByTestId('c64u-file-picker')).toBeVisible();
    await captureScreenshot(page, testInfo, 'play/import/02-c64u-file-picker.png');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const localDialog = page.getByRole('dialog');
    await expect(localDialog.getByTestId('browse-source-seed-local-source')).toBeVisible();
    await localDialog.getByTestId('browse-source-seed-local-source').click();
    await expect(localDialog.getByTestId('local-file-picker')).toBeVisible();
    await captureScreenshot(page, testInfo, 'play/import/03-local-file-picker.png');
  });

  test('capture settings screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, 'settings/01-overview.png');
    await capturePageSections(page, testInfo, 'settings');
  });

  test('capture diagnostics screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.waitForFunction(() => Boolean((window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces));
    await seedDiagnosticsTraces(page);

    const diagnosticsButton = page.getByRole('button', { name: 'Diagnostics', exact: true });
    await diagnosticsButton.scrollIntoViewIfNeeded();
    await diagnosticsButton.click();

    const dialog = page.getByRole('dialog', { name: 'Diagnostics' });
    await expect(dialog).toBeVisible();

    const actionsTab = dialog.getByRole('tab', { name: 'Actions' });
    await actionsTab.click();
    const actionSummary = dialog.getByTestId('action-summary-COR-1000');
    await expect(actionSummary).toBeVisible();
    await actionSummary.locator('summary').click();
    await expect(actionSummary).toHaveJSProperty('open', true);
    await captureScreenshot(page, testInfo, 'diagnostics/01-actions-expanded.png');

    const tracesTab = dialog.getByRole('tab', { name: 'Traces' });
    await tracesTab.click();
    const traceItem = dialog.getByTestId('trace-item-TRACE-1001');
    await expect(traceItem).toBeVisible();
    await traceItem.locator('summary').click();
    await expect(traceItem).toHaveJSProperty('open', true);
    await captureScreenshot(page, testInfo, 'diagnostics/02-traces-expanded.png');

    const logsTab = dialog.getByRole('tab', { name: 'Logs' });
    await logsTab.click();
    await expect(dialog.getByText('Total logs:')).toBeVisible();
    await captureScreenshot(page, testInfo, 'diagnostics/03-logs.png');
    const logEntry = dialog.getByTestId('log-entry-log-1');
    await expect(logEntry).toBeVisible();
    await logEntry.locator('summary').click();
    await expect(logEntry).toHaveJSProperty('open', true);
    await captureScreenshot(page, testInfo, 'diagnostics/03-logs-expanded.png');

    const errorsTab = dialog.getByRole('tab', { name: 'Errors' });
    await errorsTab.click();
    await expect(dialog.getByText('Total errors:')).toBeVisible();
    await captureScreenshot(page, testInfo, 'diagnostics/04-errors.png');
    const errorEntry = dialog.getByTestId('error-log-log-3');
    await expect(errorEntry).toBeVisible();
    await errorEntry.locator('summary').click();
    await expect(errorEntry).toHaveJSProperty('open', true);
    await captureScreenshot(page, testInfo, 'diagnostics/04-errors-expanded.png');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('capture docs screenshots', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: 'Docs' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, testInfo, 'docs/01-overview.png');
    await captureDocsSections(page, testInfo);

    await scrollAndCapture(page, testInfo, page.getByText('External Resources', { exact: true }), 'docs/external/01-external-resources.png');
  });

  test('capture demo mode play screenshot', { tag: '@screenshots' }, async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('demo.invalid')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"product":""}' });
        return;
      }
      await route.continue();
    });

    await page.addInitScript(({ baseUrl }) => {
      localStorage.setItem('c64u_startup_discovery_window_ms', '600');
      localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
      localStorage.setItem('c64u_background_rediscovery_interval_ms', '5000');
      localStorage.setItem('c64u_device_host', 'demo.invalid');
      localStorage.removeItem('c64u_password');
      localStorage.removeItem('c64u_has_password');
      delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
      (window as Window & { __c64uMockServerBaseUrl?: string }).__c64uMockServerBaseUrl = baseUrl;
      (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = baseUrl;
      (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = [baseUrl, 'http://demo.invalid'];
    }, { baseUrl: server.baseUrl });

    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    const demoDialog = page.getByRole('heading', { name: 'Demo Mode' });
    if (await demoDialog.isVisible()) {
      await page.getByRole('button', { name: 'Continue in Demo Mode' }).click();
      await expect(demoDialog).toHaveCount(0);
    }
    await expect(page.getByTestId('connectivity-indicator')).toHaveAttribute('data-connection-state', 'DEMO_ACTIVE');
    await captureScreenshot(page, testInfo, 'play/05-demo-mode.png');
  });
});
