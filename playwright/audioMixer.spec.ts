import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const getSlider = (page: Page, id: string) => page.getByTestId(`audio-mixer-slider-${id}`);
const getValue = (page: Page, id: string) => page.getByTestId(`audio-mixer-value-${id}`);
const getSoloToggle = (page: Page, id: string) => page.getByTestId(`audio-mixer-solo-${id}`);

const sliderIds = [
  'vol-ultisid-1',
  'vol-ultisid-2',
  'vol-socket-1',
  'vol-socket-2',
];


const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Audio Mixer volumes', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
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

  test('changing one volume does not change other sliders', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const initialState = server.getState()['Audio Mixer'];
    const requests: Array<{ method: string; url: string }> = [];
    await page.route('**/v1/configs**', async (route: any) => {
      const request = route.request();
      requests.push({ method: request.method(), url: request.url() });
      await route.continue();
    });

    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-open');

    const baseline = await Promise.all(sliderIds.map(async (id) => (await getValue(page, id).textContent())?.trim() || ''));

    const slider = getSlider(page, 'vol-ultisid-1');
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width * 0.8, y: sliderBox.height / 2 } });
    }

    const updated = await Promise.all(sliderIds.map(async (id) => (await getValue(page, id).textContent())?.trim() || ''));
    await snap(page, testInfo, 'volume-changed');

    expect(updated[0]).not.toBe(baseline[0]);
    expect(updated.slice(1)).toEqual(baseline.slice(1));

    const batchUpdates = requests.filter((req) => req.method === 'POST' && req.url.includes('/v1/configs'));
    expect(batchUpdates.length).toBe(0);
    const itemUpdates = requests.filter((req) => req.method === 'PUT' && req.url.includes('/v1/configs/Audio%20Mixer'));
    expect(itemUpdates.length).toBeGreaterThan(0);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 1'].value).not.toBe(initialState['Vol UltiSid 1'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe(initialState['Vol UltiSid 2'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe(initialState['Vol Socket 1'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe(initialState['Vol Socket 2'].value);
    await snap(page, testInfo, 'updates-sent');
  });

  test('editing while solo active restores other volumes', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const initialState = server.getState()['Audio Mixer'];
    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-open');

    await getSoloToggle(page, 'vol-ultisid-1').click();
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('OFF');
    await snap(page, testInfo, 'solo-enabled');

    const slider = getSlider(page, 'vol-ultisid-1');
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width * 0.8, y: sliderBox.height / 2 } });
    }
    await expect(getSoloToggle(page, 'vol-ultisid-1')).toHaveAttribute('aria-checked', 'false');
    await snap(page, testInfo, 'solo-cleared-after-edit');

    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe(initialState['Vol Socket 1'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe(initialState['Vol Socket 2'].value);
    await expect.poll(() => server.getState()['Audio Mixer']['Vol UltiSid 2'].value).toBe(initialState['Vol UltiSid 2'].value);
    await snap(page, testInfo, 'volumes-restored');
  });

  test('solo routing is disabled while editing volumes', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-open');

    await getSoloToggle(page, 'vol-ultisid-1').click();
    await expect(getSoloToggle(page, 'vol-ultisid-1')).toHaveAttribute('aria-checked', 'true');
    await snap(page, testInfo, 'solo-enabled');

    const slider = getSlider(page, 'vol-socket-1');
    const sliderBox = await slider.boundingBox();
    if (sliderBox) {
      await slider.click({ position: { x: sliderBox.width * 0.8, y: sliderBox.height / 2 } });
    }

    await expect(getSoloToggle(page, 'vol-ultisid-1')).toHaveAttribute('aria-checked', 'false');
    await snap(page, testInfo, 'solo-disabled');
  });

  test('reset audio mixer applies defaults', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-open');

    await page.getByRole('button', { name: 'Reset Audio Mixer' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Audio Mixer reset' }).first(),
    ).toBeVisible();
    await snap(page, testInfo, 'audio-mixer-reset');
  });
});
