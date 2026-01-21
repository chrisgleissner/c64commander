import type { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export default async function globalTeardown(config: FullConfig) {
  console.log('[COVERAGE] Global teardown - coverage should have been collected per-test');
  
  // Merge all coverage files
  const nycOutput = path.join(process.cwd(), '.nyc_output');
  if (fs.existsSync(nycOutput)) {
    const files = fs.readdirSync(nycOutput).filter(f => f.endsWith('.json'));
    console.log(`[COVERAGE] Found ${files.length} coverage files`);
  } else {
    console.log('[COVERAGE] No .nyc_output directory found');
  }
}
