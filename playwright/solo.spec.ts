import { test, expect, type Page } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';

test.describe('Quick page SID solo routing', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }) => {
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async () => {
    await server.close();
  });

  const openQuickAudio = async (page: Page) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick', exact: true }).click();
    await page.getByRole('button', { name: 'Audio (SID)' }).click();
  };

  test('default state has no solo enabled', async ({ page }) => {
    await openQuickAudio(page);
    await expect(page.getByLabel('Solo Vol UltiSid 1')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol UltiSid 2')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol Socket 1')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol Socket 2')).not.toBeChecked();
  });

  test('solo enable mutes other SIDs without moving sliders', async ({ page }) => {
    await openQuickAudio(page);
    await page.getByLabel('Solo Vol UltiSid 2').click();

    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('OFF');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('OFF');

    await expect(page.getByText('Vol Socket 1').locator('..').getByText('-6 dB')).toBeVisible();
    await expect(page.getByText('Vol Socket 2').locator('..').getByText('+1 dB')).toBeVisible();
  });

  test('solo switch toggles active SID instantly', async ({ page }) => {
    await openQuickAudio(page);
    await page.getByLabel('Solo Vol UltiSid 2').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('OFF');

    await page.getByLabel('Solo Vol Socket 1').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('-6 dB');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe('OFF');
  });

  test('solo disable restores configured mix', async ({ page }) => {
    await openQuickAudio(page);
    await page.getByLabel('Solo Vol Socket 2').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe('OFF');

    await page.getByLabel('Solo Vol Socket 2').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe('+2 dB');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('-6 dB');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('+1 dB');
  });

  test('navigation reset clears solo and restores mix', async ({ page }) => {
    await openQuickAudio(page);
    await page.getByLabel('Solo Vol Socket 1').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('OFF');

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await openQuickAudio(page);

    await expect(page.getByLabel('Solo Vol Socket 1')).not.toBeChecked();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('+1 dB');
  });
});
