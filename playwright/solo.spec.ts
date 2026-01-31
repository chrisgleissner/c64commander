import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring, allowVisualOverflow } from './testArtifacts';
import { enableTraceAssertions } from './traceUtils';

test.describe('Config page SID solo routing', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
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

  const openAudioMixer = async (page: Page) => {
    await page.goto('/config');
    await page.getByRole('button', { name: 'Audio Mixer' }).click();
  };

  const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
  };

  const assertLabelsHorizontal = async (page: Page, groupName: string, viewportWidth: number) => {
    const groupButton = page.getByRole('button', { name: groupName, exact: true });
    await groupButton.scrollIntoViewIfNeeded();
    const groupCard = groupButton.locator('..');
    const labels = groupCard.getByTestId('config-item-label');
    await expect.poll(async () => labels.count()).toBeGreaterThan(0);
    const count = await labels.count();

    for (let index = 0; index < count; index += 1) {
      const label = labels.nth(index);
      await expect(label).toBeVisible();
      const box = await label.boundingBox();
      if (!box) continue;
      expect(box.width).toBeGreaterThan(0);
      expect(box.width).toBeGreaterThan(box.height * 1.1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
      const writingMode = await label.evaluate((el) => getComputedStyle(el).writingMode);
      expect(writingMode).toBe('horizontal-tb');
      const transform = await label.evaluate((el) => getComputedStyle(el).transform);
      expect(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)').toBeTruthy();
    }
  };

  test('default state has no solo enabled', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await expect(page.getByLabel('Solo Vol UltiSid 1')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol UltiSid 2')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol Socket 1')).not.toBeChecked();
    await expect(page.getByLabel('Solo Vol Socket 2')).not.toBeChecked();
    await snap(page, testInfo, 'solo-disabled');
  });

  test('solo enable mutes other SIDs without moving sliders', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, 'Audio mixer solo controls expand beyond viewport');
    await openAudioMixer(page);
    await snap(page, testInfo, 'audio-mixer-open');
    await page.getByLabel('Solo Vol UltiSid 2').click();
    await snap(page, testInfo, 'solo-enabled');

    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 1'].value).toBe('OFF');
    await expect.poll(() => server.getState()['Audio Mixer']['Vol Socket 2'].value).toBe('OFF');

    await expect(page.getByTestId('audio-mixer-value-vol-socket-1')).toHaveText('-6 dB');
    await expect(page.getByTestId('audio-mixer-value-vol-socket-2')).toHaveText('+1 dB');
    await snap(page, testInfo, 'mix-muted');
  });

  test('solo switch toggles active SID instantly', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, 'Audio mixer solo controls expand beyond viewport');
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

  test('solo disable restores configured mix', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, 'Audio mixer solo controls expand beyond viewport');
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

  test('navigation reset clears solo and restores mix', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowVisualOverflow(testInfo, 'Audio mixer solo controls expand beyond viewport');
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

  test('config labels stay horizontal at narrow widths', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/config');

    await page.getByRole('button', { name: 'Audio Mixer', exact: true }).click();
    await assertLabelsHorizontal(page, 'Audio Mixer', 360);

    await page.getByRole('button', { name: 'Drive A Settings', exact: true }).click();
    await assertLabelsHorizontal(page, 'Drive A Settings', 360);

    await snap(page, testInfo, 'config-labels-horizontal');
  });
});
