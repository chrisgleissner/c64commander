/**
 * Node-only YAML loader for tests
 * This file should only be imported by tests/mocks, not by browser code
 */
import yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const yamlPath = path.resolve(__dirname, '../../../doc/c64/c64u-config.yaml');

export const loadConfigYaml = () => {
  const configYamlContent = fs.readFileSync(yamlPath, 'utf-8');
  return yaml.load(configYamlContent);
};
