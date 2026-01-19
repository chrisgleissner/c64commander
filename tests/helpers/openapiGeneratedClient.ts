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
