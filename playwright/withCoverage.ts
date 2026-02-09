/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const istanbulCLIOutput = path.join(process.cwd(), '.nyc_output');
const coverageEnabled = process.env.VITE_COVERAGE === '1' || process.env.VITE_COVERAGE === 'true';

function generateUUID(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Wrap test callback to automatically save coverage after test completes
 * Call this at the END of every test, before it finishes
 */
export async function saveCoverageFromPage(page: Page, testName?: string): Promise<void> {
  if (!coverageEnabled) {
    return;
  }
  const fileName = `coverage-${generateUUID()}.json`;
  try {
    const coverage = await page.evaluate(() => (window as any).__coverage__);
    if (coverage) {
      if (!fs.existsSync(istanbulCLIOutput)) {
        fs.mkdirSync(istanbulCLIOutput, { recursive: true });
      }
      await fs.promises.writeFile(
        path.join(istanbulCLIOutput, fileName),
        JSON.stringify(coverage)
      );
    }
  } catch {
    // Intentionally silent to avoid disrupting Playwright progress output.
  }
}
