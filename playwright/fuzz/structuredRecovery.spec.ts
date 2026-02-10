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
import { attemptStructuredRecovery } from './fuzzRecovery';

test.describe('Fuzz structured recovery', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }) => {
    server = await createMockC64Server();
    await seedUiMocks(page, server.baseUrl);
    await page.addInitScript(({ baseUrl }: { baseUrl: string }) => {
      localStorage.setItem('c64u_app_configs', JSON.stringify([{
        id: 'existing',
        name: 'confirm',
        baseUrl,
        savedAt: new Date().toISOString(),
        data: {},
      }]));
    }, { baseUrl: server.baseUrl });
  });

  test.afterEach(async () => {
    await server.close();
  });

  test('recovery completes save dialog with unique name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('connectivity-indicator')).toHaveAttribute(
      'data-connection-state',
      /(REAL_CONNECTED|DEMO_ACTIVE)/,
    );
    await page.getByText('To App').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const dialog = page.getByRole('dialog');
    let closed = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await attemptStructuredRecovery(page, {
        seed: 4242,
        sessionId: 'test',
        attempt,
      });
      expect(result.recovered).toBe(true);
      closed = !(await dialog.isVisible().catch(() => false));
      if (closed) break;
      await page.waitForTimeout(200);
    }

    expect(closed).toBe(true);

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('c64u_app_configs');
      return raw ? JSON.parse(raw) : [];
    });

    expect(stored).toHaveLength(2);
    expect(stored.some((entry: { name: string }) => entry.name !== 'confirm')).toBe(true);
  });
});
