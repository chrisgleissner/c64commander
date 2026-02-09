/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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
