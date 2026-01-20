import { test, expect, type Page } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';

test.describe('UI coverage', () => {
  test.describe.configure({ mode: 'parallel' });

  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }) => {
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
    await page.addStyleTag({
      content: '[aria-label="Notifications (F8)"] { pointer-events: none !important; }',
    });
  });

  test.afterEach(async () => {
    await server.close();
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

  test('config widgets read/write and refresh', async ({ page }: { page: Page }) => {
    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'U64 Specific Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();

    const selectTrigger = page.getByLabel('System Mode select');
    await selectTrigger.click();
    await page.getByRole('option', { name: /^NTSC$/ }).click();

    const checkbox = page.getByLabel('HDMI Scan lines checkbox');
    await checkbox.click();

    await page.getByRole('button', { name: 'Audio Mixer' }).click();
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

    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();
    await expect(page.getByLabel('System Mode select')).toContainText('NTSC');
  });

  test('home and disks pages render', async ({ page }: { page: Page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'C64 Commander' })).toBeVisible();

    await page.goto('/disks', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('header').getByRole('heading', { name: 'Disks' })).toBeVisible();
  });

  test('config page renders and toggles a section', async ({ page }: { page: Page }) => {
    await page.goto('/config', { waitUntil: 'domcontentloaded' });
    const section = page.getByRole('button', { name: 'U64 Specific Settings' });
    await section.click();
    await expect(page.getByText('System Mode')).toBeVisible();
  });

  test('play page renders with HVSC controls', async ({ page }: { page: Page }) => {
    await enableHvscDownloads(page);
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Install HVSC|Check updates/ })).toBeVisible();
  });

  test('settings and docs pages render', async ({ page }: { page: Page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Documentation' })).toBeVisible();
  });
});
