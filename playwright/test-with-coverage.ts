/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TestInfo } from '@playwright/test';
import { test as base } from './coverage';
import { saveCoverage } from './coverage';

// Auto-save coverage after each test
base.afterEach(async ({ page }, testInfo: TestInfo) => {
  await saveCoverage(page, testInfo.title);
});

export { test, expect } from './coverage';
