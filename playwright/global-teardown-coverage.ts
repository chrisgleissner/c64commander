import type { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export default async function globalTeardown(config: FullConfig) {
  void config;
  const nycOutput = path.join(process.cwd(), '.nyc_output');
  if (fs.existsSync(nycOutput)) {
    fs.readdirSync(nycOutput).filter(f => f.endsWith('.json'));
  }
}
