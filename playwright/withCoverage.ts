import type { Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const istanbulCLIOutput = path.join(process.cwd(), '.nyc_output');

// Ensure .nyc_output directory exists
if (!fs.existsSync(istanbulCLIOutput)) {
  fs.mkdirSync(istanbulCLIOutput, { recursive: true });
}

function generateUUID(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Wrap test callback to automatically save coverage after test completes
 * Call this at the END of every test, before it finishes
 */
export async function saveCoverageFromPage(page: Page, testName?: string): Promise<void> {
  const fileName = `coverage-${generateUUID()}.json`;
  try {
    const coverage = await page.evaluate(() => (window as any).__coverage__);
    if (coverage) {
      await fs.promises.writeFile(
        path.join(istanbulCLIOutput, fileName),
        JSON.stringify(coverage)
      );
      console.log(`[COVERAGE] ✓ Saved ${fileName}`);
    } else {
      console.warn(`[COVERAGE] ✗ No __coverage__ found for: ${testName || 'unknown'}`);
    }
  } catch (error) {
    console.error(`[COVERAGE] ✗ Failed for ${testName || 'unknown'}: ${error}`);
  }
}
