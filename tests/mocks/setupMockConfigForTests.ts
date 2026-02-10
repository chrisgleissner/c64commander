/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { setMockConfigLoader } from '../../src/lib/mock/mockConfig.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load full YAML config for tests
const yamlPath = path.resolve(__dirname, '../../doc/c64/c64u-config.yaml');
const yamlContent = fs.readFileSync(yamlPath, 'utf8');

// Set the custom loader for tests
setMockConfigLoader(() => yaml.load(yamlContent));
