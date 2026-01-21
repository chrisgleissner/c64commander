import fs from 'fs';
import path from 'path';
import { test as base, type Page } from '@playwright/test';

const istanbulCLIOutput = path.join(process.cwd(), '.nyc_output');

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Manually save coverage from a page.
 * Call this at the end of your test before assertions.
 */
export async function saveCoverage(page: Page, testName?: string): Promise<void> {
  try {
    const coverage = await page.evaluate(() => window.__coverage__);
    if (coverage) {
      await fs.promises.mkdir(istanbulCLIOutput, { recursive: true });
      const uuid = generateUUID();
      const safeName = testName ? testName.replace(/[^a-z0-9]/gi, '_').substring(0, 50) : 'test';
      const fileName = `coverage-${safeName}-${uuid}.json`;
      const filePath = path.join(istanbulCLIOutput, fileName);
      await fs.promises.writeFile(filePath, JSON.stringify(coverage));
    }
  } catch (error) {
    // Ignore if page is closed or coverage not available
  }
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    // Try to save coverage after test (best effort)
    await saveCoverage(page, testInfo.title);
  },
});

export const expect = test.expect;
