import { defineConfig } from '@playwright/test';
import os from 'os';

const coverageEnv = process.env.VITE_COVERAGE ? 'VITE_COVERAGE=true ' : '';
const probeEnv = 'VITE_ENABLE_TEST_PROBES=1 ';
const skipBuild = process.env.PLAYWRIGHT_SKIP_BUILD === '1';
const explicitWorkers = process.env.PLAYWRIGHT_WORKERS?.trim();
const parsedWorkers =
  explicitWorkers && /^[0-9]+$/.test(explicitWorkers) ? Number(explicitWorkers) : undefined;
const cpuCount = os.cpus().length;
const defaultWorkers = Math.min(4, Math.max(1, cpuCount));
const resolvedWorkers = parsedWorkers ?? defaultWorkers;
const webServerCommand = skipBuild
  ? `${coverageEnv}${probeEnv}npm run preview -- --host 127.0.0.1 --port 4173`
  : `${coverageEnv}${probeEnv}npm run build && ${coverageEnv}${probeEnv}npm run preview -- --host 127.0.0.1 --port 4173`;

export default defineConfig({
  testDir: './playwright',
  outputDir: 'test-results/playwright',
  preserveOutput: 'always',
  workers: resolvedWorkers,
  timeout: 60000,
  expect: { timeout: 10000 },
  globalTeardown: './playwright/global-teardown-coverage.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  webServer: {
    command: webServerCommand,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
