import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, startStrictUiMonitoring } from './testArtifacts';

test.describe('Config page SID solo routing', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    await assertNoUiIssues(page, testInfo);
    await server.close();
  });

  const openAudioMixer = async (page: Page) => {
    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
  };

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  test('default state has no solo enabled', async ({ page }: { page: Page }, testInfo) => {
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await expect(page.getByLabel('Solo Vol UltiSid 1')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol UltiSid 2')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol Socket 1')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol Socket 2')).not.toBeChecked();
    await snap(page, testInfo, 'solo-disabled');
  });

  test('solo enable mutes other SIDs without moving sliders', async ({ page }: { page: Page }, testInfo) => {
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await page.getByLabel('Solo Vol UltiSid 2').click();
    await snap(page, testInfo, 'solo-enabled');

    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('OFF');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('OFF');

    await expect(page.getByText('Vol Socket 1').locator('..').getByText('-6 dB')).toBeVisible();
    await expect(page.getByText('Vol Socket 2').locator('..').getByText('+1 dB')).toBeVisible();
    await snap(page, testInfo, 'mix-muted');
  });

  test('solo switch toggles active SID instantly', async ({ page }: { page: Page }, testInfo) => {
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await page.getByLabel('Solo Vol UltiSid 2').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('OFF');
    await snap(page, testInfo, 'solo-first');

    await page.getByLabel('Solo Vol Socket 1').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('-6 dB');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe('OFF');
    await snap(page, testInfo, 'solo-switched');
  });

  test('solo disable restores configured mix', async ({ page }: { page: Page }, testInfo) => {
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await page.getByLabel('Solo Vol Socket 2').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe('OFF');
    await snap(page, testInfo, 'solo-enabled');

    await page.getByLabel('Solo Vol Socket 2').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe('+2 dB');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('-6 dB');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('+1 dB');
    await snap(page, testInfo, 'solo-disabled');
  });

  test('navigation reset clears solo and restores mix', async ({ page }: { page: Page }, testInfo) => {
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await page.getByLabel('Solo Vol Socket 1').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('OFF');
    await snap(page, testInfo, 'solo-enabled');

    await page.goto('/');
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-return');

    await expect(page.getByLabel('Solo Vol Socket 1')).not.toBeChecked();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('+1 dB');
    await snap(page, testInfo, 'solo-cleared');
  });
});
