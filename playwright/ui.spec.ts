import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';
import { clickSourceSelectionButton } from './sourceSelection';

const resolveExpectedVersion = () => {
  const envVersion = process.env.VITE_APP_VERSION || process.env.VERSION_NAME || '';
  if (envVersion) return envVersion;
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  try {
    const tag = execSync('git describe --tags --exact-match', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (tag) return tag;
  } catch {
    // ignore
  }
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version?: string };
  return pkg.version || '';
};

test.describe('UI coverage', () => {
  test.describe.configure({ mode: 'parallel' });

  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
    await page.addStyleTag({
      content: '[aria-label="Notifications (F8)"] { pointer-events: none !important; }',
    });
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

  const clickAllButtons = async (
    page: Page,
    scope: Page | ReturnType<Page['locator']>,
    options: { maxClicks?: number; timeBudgetMs?: number } = {},
  ) => {
    const locator = 'locator' in scope ? scope.locator('button') : scope.locator('button');
    const handles = await locator.elementHandles();
    const maxClicks = options.maxClicks ?? 12;
    const deadline = Date.now() + (options.timeBudgetMs ?? 1500);
    let clicks = 0;
    for (const handle of handles) {
      if (page.isClosed()) return;
      if (clicks >= maxClicks || Date.now() > deadline) return;
      const isClickable = await handle.evaluate((el: Element) => {
        const button = el as HTMLButtonElement;
        const ariaDisabled = button.getAttribute('aria-disabled') === 'true';
        const skipClick = button.hasAttribute('data-skip-click');
        return !skipClick && !button.disabled && !ariaDisabled && button.offsetParent !== null;
      });
      if (!isClickable) continue;
      try {
        await handle.scrollIntoViewIfNeeded();
        await handle.click();
        clicks += 1;
      } catch (error) {
        console.warn('Button click failed during UI sweep', error);
      }

      const closeButton = page.getByRole('button', { name: /close|cancel|done|dismiss|back/i }).first();
      try {
        if (!page.isClosed() && (await closeButton.isVisible())) {
          await closeButton.click();
        }
      } catch (error) {
        console.warn('Close action failed during UI sweep', error);
      }
    }
  };

  const enableDeveloperMode = async (page: Page) => {
    await page.goto('/settings');
    const aboutButton = page.getByRole('button', { name: 'About' });
    for (let i = 0; i < 7; i += 1) {
      await aboutButton.click();
    }
  };

  const enableHvscDownloads = async (page: Page) => {
    await enableDeveloperMode(page);
    const toggle = page.getByLabel('Enable HVSC downloads');
    await expect(toggle).toBeVisible();
    if (!(await toggle.isChecked())) {
      await toggle.click();
    }
    await expect(toggle).toBeChecked();
  };

  const ensureRemoteRoot = async (page: Page) => {
    const rootButton = page.locator('[data-testid="navigate-root"]');
    const visible = await rootButton.isVisible().catch(() => false);
    if (!visible) return;
    const disabledAttr = await rootButton.getAttribute('disabled').catch(() => null);
    const ariaDisabled = await rootButton.getAttribute('aria-disabled').catch(() => null);
    if (disabledAttr !== null || ariaDisabled === 'true') return;
    try {
      await rootButton.click({ timeout: 2000 });
    } catch {
      // Ignore: navigation may have already reached root.
    }
  };

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  test('config widgets read/write and refresh', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'config-open');
    await expect(page.getByRole('button', { name: 'U64 Specific Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();

    const selectTrigger = page.getByLabel('System Mode select');
    await selectTrigger.click();
    await page.getByRole('option', { name: /^NTSC$/ }).click();

    const checkbox = page.getByLabel('HDMI Scan lines checkbox');
    await checkbox.click();

    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-open');
    const slider = page.getByLabel('Vol UltiSid 1 slider');
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width - 2, y: sliderBox.height / 2 } });
    }

    await expect.poll(() => server.getState()['U64 Specific Settings']['System Mode'].value).toBe('NTSC');
    await expect.poll(() => server.getState()['U64 Specific Settings']['HDMI Scan lines'].value).toBe('Disabled');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 1'].value).toBe('+6 dB');

    const refreshCount = server.requests.length;
    const refreshButton = page.getByRole('button', { name: 'Refresh' }).first();
    await refreshButton.click();
    await expect.poll(() => server.requests.length).toBeGreaterThan(refreshCount);
    await snap(page, testInfo, 'config-refreshed');

    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();
    await expect(page.getByLabel('System Mode select')).toContainText('NTSC');
    await snap(page, testInfo, 'config-updated');
  });

  test('config group actions stay at top of expanded section', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'config-open');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-expanded');
    const actions = page.getByTestId('config-group-actions');
    const list = page.getByTestId('config-group-list');
    const [actionsBox, listBox] = await Promise.all([actions.boundingBox(), list.boundingBox()]);
    expect(actionsBox?.y ?? 0).toBeLessThan(listBox?.y ?? Number.MAX_SAFE_INTEGER);
  });

  test('home and disks pages render', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'C64 Commander' })).toBeVisible();
    await snap(page, testInfo, 'home-open');

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').getByRole('heading', { name: 'Disks' })).toBeVisible();
    await snap(page, testInfo, 'disks-open');
  });

  test('home page shows resolved version', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const expectedVersion = resolveExpectedVersion() || '—';
    const versionCard = page.getByText('Version', { exact: true }).locator('..');
    await expect(versionCard.locator('p')).toHaveText(expectedVersion);
    await snap(page, testInfo, 'home-version');
  });

  test('config page renders and toggles a section', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    await snap(page, testInfo, 'config-open');
    const section = page.getByRole('button', { name: 'U64 Specific Settings' });
    await section.click();
    await expect(page.getByText('System Mode')).toBeVisible();
    await snap(page, testInfo, 'section-expanded');
  });

  test('play page renders with HVSC controls', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await enableHvscDownloads(page);
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Install HVSC|Check updates/ })).toBeVisible();
    await snap(page, testInfo, 'play-hvsc');
  });

  test('add-items shows progress feedback after confirm', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const ftpServers = await startFtpTestServers();
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await page.route('**/v1/ftp/list', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await ensureRemoteRoot(page);
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await snap(page, testInfo, 'c64u-root');
    await dialog.getByText('Usb0', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await dialog.getByText('Games', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await dialog.getByText('Turrican II', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await dialog.getByText('Disk 1.d64', { exact: true }).locator('..').locator('..').getByRole('checkbox').click();
    await page.getByTestId('add-items-confirm').click();
    await expect(page.getByTestId('add-items-progress')).toBeVisible();
    await snap(page, testInfo, 'progress-visible');
    await ftpServers.close();
  });

  test('selection state stays stable when filtering', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const ftpServers = await startFtpTestServers();
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await ensureRemoteRoot(page);
    await expect(dialog.getByText('Usb0', { exact: true })).toBeVisible();
    await dialog.getByText('Usb0', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await expect(dialog.getByText('Games', { exact: true })).toBeVisible();
    await dialog.getByText('Games', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await expect(dialog.getByText('Turrican II', { exact: true })).toBeVisible();
    await dialog.getByText('Turrican II', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await expect(dialog.getByText('Disk 1.d64', { exact: true })).toBeVisible();
    await dialog.getByText('Disk 1.d64', { exact: true }).locator('..').locator('..').getByRole('checkbox').click();
    await snap(page, testInfo, 'selection-made');

    await page.getByTestId('add-items-filter').fill('Disk');
    await expect(page.getByTestId('add-items-selection-count')).toHaveText(/1 selected/i);
    await snap(page, testInfo, 'filter-applied');
    await ftpServers.close();
  });

  test('item browser does not overflow viewport width', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const ftpServers = await startFtpTestServers();
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    const dialog = page.getByRole('dialog');
    await clickSourceSelectionButton(dialog, 'C64 Ultimate');
    await ensureRemoteRoot(page);
    await dialog.getByText('Usb0', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await dialog.getByText('Games', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await dialog.getByText('Turrican II', { exact: true }).locator('..').locator('..').locator('..').getByRole('button', { name: 'Open' }).click();
    await snap(page, testInfo, 'deep-folder');

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
    await snap(page, testInfo, 'no-overflow');
    await ftpServers.close();
  });

  test('settings and docs pages render', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await snap(page, testInfo, 'settings-open');

    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible();
    await snap(page, testInfo, 'docs-open');
  });
});
