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

  const clickAllButtons = async (page: Page, scope: Page | ReturnType<Page['locator']>) => {
    const locator = 'locator' in scope ? scope.locator('button') : scope.locator('button');
    const handles = await locator.elementHandles();
    for (const handle of handles) {
      if (page.isClosed()) return;
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
      } catch {
        // Ignore transient DOM changes
      }

      const closeButton = page.getByRole('button', { name: /close|cancel|done|dismiss|back/i }).first();
      try {
        if (!page.isClosed() && (await closeButton.isVisible())) {
          await closeButton.click();
        }
      } catch {
        // Ignore navigation/teardown edge cases
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

  test('config widgets read/write, refresh, and revert defaults', async ({ page }: { page: Page }) => {
    await page.goto('/config');
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

    await page.goto('/');
    const revertButton = page.getByRole('button', { name: 'Revert' }).first();
    await expect(revertButton).toBeEnabled();
    await revertButton.click();
    await expect.poll(() => server.getState()['U64 Specific Settings']['System Mode'].value).toBe('PAL');
    await expect.poll(() => server.getState()['U64 Specific Settings']['HDMI Scan lines'].value).toBe('Enabled');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 1'].value).toBe('OFF');

    await page.goto('/config');
    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();
    await expect(page.getByLabel('System Mode select')).toContainText('PAL');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await expect(page.getByText('Vol UltiSid 1').locator('..').getByText('OFF')).toBeVisible();
  });

  test('clicks widgets on home and quick pages', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await clickAllButtons(page, page.locator('main'));

    await page.goto('/quick');
    await clickAllButtons(page, page.locator('main'));
  });

  test('clicks widgets on config page', async ({ page }: { page: Page }) => {
    await page.goto('/config');
    await clickAllButtons(page, page.locator('main'));
  });

  test('clicks widgets on play page', async ({ page }: { page: Page }) => {
    await enableHvscDownloads(page);
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'Play Files' })).toBeVisible();
    await clickAllButtons(page, page.locator('main'));
  });

  test('clicks widgets on settings and docs pages', async ({ page }: { page: Page }) => {
    await page.goto('/settings');
    await page.getByRole('textbox', { name: 'Base URL' }).fill(server.baseUrl);
    await page.getByLabel('Network Password').fill('pw');
    await page.getByRole('button', { name: 'Save & Connect' }).click();
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await page.keyboard.press('Escape');
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Docs', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));
  });
});
