/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test('debug demo dialog timing', async ({ page }: { page: Page }) => {
  test.setTimeout(60000);

  await page.addInitScript(() => {
    const unreachableBaseUrl = 'http://127.0.0.1:1';
    (window as Window & { __c64uExpectedBaseUrl?: string }).__c64uExpectedBaseUrl = unreachableBaseUrl;
    (window as Window & { __c64uAllowedBaseUrls?: string[] }).__c64uAllowedBaseUrls = [unreachableBaseUrl];
    localStorage.setItem('c64u_startup_discovery_window_ms', '600');
    localStorage.setItem('c64u_automatic_demo_mode_enabled', '1');
    localStorage.setItem('c64u_background_rediscovery_interval_ms', '5000');
    localStorage.setItem('c64u_device_host', '127.0.0.1:1');
    localStorage.removeItem('c64u_password');
    localStorage.removeItem('c64u_has_password');
    sessionStorage.removeItem('c64u_demo_interstitial_shown');
    delete (window as Window & { __c64uSecureStorageOverride?: unknown }).__c64uSecureStorageOverride;
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const indicator = page.getByTestId('connectivity-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAttribute('data-connection-state', /DEMO_ACTIVE|DISCOVERING|OFFLINE_NO_DEMO/, {
    timeout: 15000,
  });
});
