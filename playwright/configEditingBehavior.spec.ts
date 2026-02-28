import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { uiFixtures } from './uiMocks';
import { assertNoUiIssues, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import { saveCoverageFromPage } from './withCoverage';

const buildSnapshot = (state: Record<string, Record<string, { value: string | number; options?: string[]; details?: Record<string, unknown> }>>) => {
  const data: Record<string, unknown> = {};
  Object.entries(state).forEach(([category, items]) => {
    const payloadItems: Record<string, unknown> = {};
    Object.entries(items).forEach(([name, item]) => {
      payloadItems[name] = {
        selected: item.value,
        options: item.options ?? [],
        details: item.details,
      };
    });
    data[category] = { [category]: { items: payloadItems }, errors: [] };
  });
  return {
    savedAt: new Date().toISOString(),
    data,
  };
};

const seedConnection = async (page: Page, baseUrl: string, snapshot: unknown) => {
  await page.addInitScript(({ baseUrl: runtimeBaseUrl, snapshot: initialSnapshot }) => {
    const routingWindow = window as Window & {
      __c64uExpectedBaseUrl?: string;
      __c64uAllowedBaseUrls?: string[];
      __c64uTestProbeEnabled?: boolean;
      __c64uSecureStorageOverride?: unknown;
    };
    routingWindow.__c64uExpectedBaseUrl = runtimeBaseUrl;
    routingWindow.__c64uAllowedBaseUrls = [runtimeBaseUrl];
    routingWindow.__c64uTestProbeEnabled = true;
    const host = runtimeBaseUrl.replace(/^https?:\/\//, '');
    localStorage.setItem('c64u_device_host', host || 'c64u');
    localStorage.removeItem('c64u_password');
    localStorage.removeItem('c64u_has_password');
    delete routingWindow.__c64uSecureStorageOverride;
    localStorage.setItem(`c64u_initial_snapshot:${runtimeBaseUrl}`, JSON.stringify(initialSnapshot));
    sessionStorage.setItem(`c64u_initial_snapshot_session:${runtimeBaseUrl}`, '1');
  }, { baseUrl, snapshot });
};

test.describe('Config editing regressions', () => {
  test('slider popup remains visible for deterministic minimum duration', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    const server = await createMockC64Server(uiFixtures.configState);
    try {
      await seedConnection(page, server.baseUrl, buildSnapshot(server.getState()));
      await page.goto('/config', { waitUntil: 'domcontentloaded' });

      await page.getByRole('button', { name: 'Audio Mixer' }).click();
      const slider = page.getByTestId('audio-mixer-slider-vol-ultisid-1');
      const thumb = slider.locator('[role="slider"]').first();
      await thumb.click();

      const popup = slider.getByTestId('slider-value-display');
      await expect(popup).toBeVisible();
      await page.waitForTimeout(350);
      await expect(popup).toBeVisible();
      await page.waitForTimeout(900);
      await expect(popup).toBeHidden();

      const markerNames = await page.evaluate(() => {
        const traces = (window as Window & { __c64uTracing?: { getTraces?: () => Array<{ type: string; data?: { name?: unknown } }> } })
          .__c64uTracing?.getTraces?.() ?? [];
        return traces
          .filter((event) => event.type === 'action-start')
          .map((event) => String(event.data?.name ?? ''));
      });
      expect(markerNames).toContain('SliderPopupOpened');
      expect(markerNames).toContain('SliderPopupClosed');
    } finally {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('text edits commit once on blur and emit edit markers', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    const server = await createMockC64Server({
      'Clock Settings': {
        'Clock Year': { value: '2025' },
      },
    });

    try {
      await seedConnection(page, server.baseUrl, buildSnapshot(server.getState()));
      await page.goto('/config', { waitUntil: 'domcontentloaded' });

      await page.getByRole('button', { name: 'Clock Settings' }).click();
      const input = page.getByLabel('Clock Year text input');
      await input.click();
      await input.fill('');
      await input.type('2026');
      await expect(input).toBeFocused();

      const updateUrl = '/v1/configs/Clock%20Settings/Clock%20Year';
      const requestsBeforeBlur = server.requests.filter((request) => request.method === 'PUT' && request.url.includes(updateUrl));
      expect(requestsBeforeBlur.length).toBe(0);

      await page.getByRole('button', { name: 'Clock Settings' }).click();

      await expect.poll(() => {
        const updates = server.requests.filter((request) => request.method === 'PUT' && request.url.includes(updateUrl));
        return updates.length;
      }).toBe(1);

      await expect.poll(() => server.getState()['Clock Settings']['Clock Year'].value).toBe('2026');

      const traceSummary = await page.evaluate(() => {
        const traces = (window as Window & {
          __c64uTracing?: {
            getTraces?: () => Array<{
              type: string;
              data?: { name?: unknown; normalizedUrl?: unknown; method?: unknown };
            }>;
          };
        }).__c64uTracing?.getTraces?.() ?? [];

        const actionNames = traces
          .filter((event) => event.type === 'action-start')
          .map((event) => String(event.data?.name ?? ''));

        const clockYearRequests = traces.filter((event) =>
          event.type === 'rest-request'
          && String(event.data?.method ?? '').toUpperCase() === 'PUT'
          && String(event.data?.normalizedUrl ?? '').includes('/v1/configs/Clock%20Settings/Clock%20Year'),
        );

        return {
          actionNames,
          requestCount: clockYearRequests.length,
        };
      });

      expect(traceSummary.actionNames).toContain('ConfigFieldEditStarted');
      expect(traceSummary.actionNames).toContain('ConfigFieldEditCommitted');
      expect(traceSummary.requestCount).toBe(1);
    } finally {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });
});
