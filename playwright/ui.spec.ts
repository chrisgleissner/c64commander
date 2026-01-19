import { test, expect, type Page } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';

test.describe('UI coverage', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeAll(async () => {
    server = await createMockC64Server(uiFixtures.configState);
  });

  test.afterAll(async () => {
    await server.close();
  });

  test.beforeEach(async ({ page }: { page: Page }) => {
    await seedUiMocks(page, server.baseUrl);
    await page.addStyleTag({
      content: '[aria-label="Notifications (F8)"] { pointer-events: none !important; }',
    });
  });

  const clickAllButtons = async (page: Page, scope: Page | ReturnType<Page['locator']>) => {
    const locator = 'locator' in scope ? scope.locator('button') : scope.locator('button');
    const handles = await locator.elementHandles();
    for (const handle of handles) {
      const isClickable = await handle.evaluate((el: Element) => {
        const button = el as HTMLButtonElement;
        const ariaDisabled = button.getAttribute('aria-disabled') === 'true';
        return !button.disabled && !ariaDisabled && button.offsetParent !== null;
      });
      if (!isClickable) continue;
      try {
        await handle.scrollIntoViewIfNeeded();
        await handle.click();
      } catch {
        // Ignore transient DOM changes
      }

      const closeButton = page.getByRole('button', { name: /close|cancel|done|dismiss|back/i }).first();
      if (await closeButton.isVisible()) {
        await closeButton.click();
      }
    }
  };

  test('config widgets read/write, refresh, and revert defaults', async ({ page }: { page: Page }) => {
    await page.goto('/config');
    await expect(page.getByRole('button', { name: 'U64 Specific Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();

    const selectTrigger = page.getByLabel('System Mode select');
    await selectTrigger.click();
    await page.getByRole('option', { name: 'NTSC' }).click();

    const checkbox = page.getByLabel('CPU Turbo checkbox');
    await checkbox.click();

    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    const slider = page.getByLabel('Vol 1 slider');
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width - 2, y: sliderBox.height / 2 } });
    }

    await expect.poll(() => server.getState()['U64 Specific Settings']['System Mode'].value).toBe('NTSC');
    await expect.poll(() => server.getState()['U64 Specific Settings']['CPU Turbo'].value).toBe('On');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol 1'].value).toBe('6 dB');

    const refreshCount = server.requests.length;
    const refreshButton = page.getByRole('button', { name: 'Refresh' }).first();
    await refreshButton.click();
    await expect.poll(() => server.requests.length).toBeGreaterThan(refreshCount);

    await page.goto('/');
    const revertButton = page.getByRole('button', { name: 'Revert' }).first();
    await expect(revertButton).toBeEnabled();
    await revertButton.click();
    await expect.poll(() => server.getState()['U64 Specific Settings']['System Mode'].value).toBe('PAL');
    await expect.poll(() => server.getState()['U64 Specific Settings']['CPU Turbo'].value).toBe('Off');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol 1'].value).toBe('0 dB');

    await page.goto('/config');
    await page.getByRole('button', { name: 'U64 Specific Settings' }).click();
    await expect(page.getByLabel('System Mode select')).toContainText('PAL');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await expect(page.getByText('Vol 1').locator('..').getByText('0 dB')).toBeVisible();
  });

  test('clicks widgets across all pages', async ({ page }: { page: Page }) => {
    await page.goto('/');
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Quick', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Config', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'SID', exact: true }).click();
    await page.getByRole('button', { name: '/DEMOS/0-9', exact: true }).click();
    const songRow = page.getByText('10_Orbyte.sid');
    await expect(songRow).toBeVisible();
    await songRow.locator('..').getByRole('button', { name: 'Play' }).click();

    await page.getByRole('tab', { name: 'Local Library' }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder' }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles([
      { name: 'local.sid', mimeType: 'audio/sid', buffer: Buffer.from(uiFixtures.fixtureBase64, 'base64') },
    ]);

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Base URL' }).fill(server.baseUrl);
    await page.getByRole('textbox', { name: 'Device Hostname' }).fill('c64u');
    await page.getByLabel('Network Password').fill('pw');
    await page.getByRole('button', { name: 'Save & Connect' }).click();
    await page.getByRole('button', { name: 'Diagnostics' }).click();
    await page.keyboard.press('Escape');
    await clickAllButtons(page, page.locator('main'));

    await page.getByRole('button', { name: 'Docs', exact: true }).click();
    await clickAllButtons(page, page.locator('main'));
  });
});
