import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { saveCoverageFromPage } from './withCoverage';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { enableTraceAssertions } from './traceUtils';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Demo config from YAML', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    enableTraceAssertions(testInfo);
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
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

  test('config page shows YAML-derived categories', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/config');
    await snap(page, testInfo, 'config-open');

    await expect(page.getByRole('button', { name: 'Audio Mixer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Network Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'U64 Specific Settings' })).toBeVisible();
    await snap(page, testInfo, 'yaml-categories-visible');
  });
});
