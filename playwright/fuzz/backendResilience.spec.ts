/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from '@playwright/test';
import { createMockC64Server } from '../../tests/mocks/mockC64Server';
import { seedUiMocks } from '../uiMocks';
import { createBackendFailureTracker, shouldIgnoreBackendFailure, type AppLogEntry } from './fuzzBackend';

const waitForLogEntry = async (
  page: import('@playwright/test').Page,
  predicate: (entry: AppLogEntry) => boolean,
  timeoutMs = 6000,
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const logs = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_logs');
      return raw ? JSON.parse(raw) : [];
    });
    const entry = (logs as AppLogEntry[]).find(predicate);
    if (entry) return entry;
    await page.waitForTimeout(200);
  }
  throw new Error('Timed out waiting for app log entry');
};

test.describe('Fuzz backend resilience', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }) => {
    server = await createMockC64Server();
    server.setReachable(false);
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
      localStorage.setItem('c64u_fuzz_mode_enabled', '1');
      localStorage.setItem('c64u_fuzz_mock_base_url', baseUrl);
      localStorage.setItem('c64u_fuzz_storage_seeded', '1');
    }, { baseUrl: server.baseUrl });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test('backend 503 logs are treated as recoverable', async ({ page }) => {
    await page.goto('/');

    const entry = await waitForLogEntry(
      page,
      (log) => log.message === 'C64 API request failed' || /Service Unavailable|HTTP 503/i.test(log.message),
    );

    const shouldIgnore = shouldIgnoreBackendFailure(entry, {
      now: Date.now(),
      serverReachable: true,
      networkOffline: false,
      faultMode: 'none',
      lastOutageAt: 0,
    });

    expect(shouldIgnore).toBe(true);

    const tracker = createBackendFailureTracker({ baseDelayMs: 200, maxDelayMs: 2000, factor: 1.8 });
    const first = tracker.recordFailure();
    const second = tracker.recordFailure();
    expect(second).toBeGreaterThanOrEqual(first);
    expect(tracker.getBackoffUntilMs()).toBeGreaterThan(0);
  });
});
