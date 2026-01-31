import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { disableTraceAssertions } from './traceUtils';

test.describe('Coverage probes', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    disableTraceAssertions(testInfo, 'Coverage-only probe routes; trace assertions disabled.');
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

  test('exercises internal helpers for coverage', async ({ page }: { page: Page }) => {
    await page.goto('/__coverage__');
    const status = page.getByTestId('coverage-probe-status');
    await expect(status).toHaveText('done', { timeout: 30000 });
    await expect(page.locator('[data-testid="coverage-probe-page"]')).toBeVisible();
    await expect(page.getByText('Errors')).toHaveCount(0);
  });

  test('covers primary routes for coverage', async ({ page }: { page: Page }) => {
    const routes = ['/', '/play', '/disks', '/settings', '/docs', '/config'];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle');
    }
  });
});
