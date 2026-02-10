/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from 'node:fs';
import path from 'node:path';
import OpenAPIClientAxios from 'openapi-client-axios';
import yaml from 'js-yaml';
import httpAdapter from 'axios/lib/adapters/http.js';

export async function createOpenApiGeneratedClient(baseURL: string) {
  const specPath = path.resolve(process.cwd(), 'doc/c64/c64u-openapi-excerpt.yaml');
  const specYaml = fs.readFileSync(specPath, 'utf8');
  const definition = yaml.load(specYaml) as any;

  const api = new OpenAPIClientAxios({
    definition,
    axiosConfigDefaults: {
      baseURL,
      adapter: httpAdapter,
      validateStatus: () => true,
    },
  });

  return api.init<any>();
}
