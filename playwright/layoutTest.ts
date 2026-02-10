/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test as base, type TestInfo } from '@playwright/test';

/**
 * Mark a test as layout-sensitive by adding @layout tag.
 * These tests will run on both phone and tablet profiles.
 * All other tests run only on phone.
 * 
 * Usage: layoutTest('my test @layout', async ({ page }) => { ... });
 */
export const layoutTest = base;

// Kept for backward compatibility with older specs using the helper.
export const enforceDeviceTestMapping = (testInfo: TestInfo) => {
  if (!testInfo.title.includes('@layout')) {
    console.warn(
      `[layoutTest] Test "${testInfo.title}" calls enforceDeviceTestMapping but is missing the @layout tag. ` +
        'Add "@layout" to the test title so grep-based filtering includes it in layout-sensitive runs.'
    );
  }
};
