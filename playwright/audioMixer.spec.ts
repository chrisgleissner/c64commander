import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, startStrictUiMonitoring } from './testArtifacts';

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

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    await assertNoUiIssues(page, testInfo);
    await server.close();
  });

  test('changing one volume does not change other sliders', async ({ page }: { page: Page }, testInfo) => {
    const requests: Array<{ method: string; url: string }> = [];
    await page.route('**/v1/configs**', async (route) => {
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
    await snap(page, testInfo, 'updates-sent');
  });

  test('solo routing is disabled while editing volumes', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
    await snap(page, testInfo, 'audio-mixer-open');

    await getSoloToggle(page, 'vol-ultisid-1').click();
    await expect(getSoloToggle(page, 'vol-ultisid-1')).toHaveAttribute('aria-checked', 'true');
    await snap(page, testInfo, 'solo-enabled');

    await getSlider(page, 'vol-socket-1').click({ position: { x: 10, y: 5 } });

    await expect(getSoloToggle(page, 'vol-ultisid-1')).toHaveAttribute('aria-checked', 'false');
    await snap(page, testInfo, 'solo-disabled');
  });
});
