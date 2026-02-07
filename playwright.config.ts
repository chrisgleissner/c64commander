import { defineConfig, devices as playwrightDevices } from '@playwright/test';
import os from 'os';

const coverageEnv = process.env.VITE_COVERAGE ? 'VITE_COVERAGE=true ' : '';
const probeEnv = 'VITE_ENABLE_TEST_PROBES=1 ';
const skipBuild = process.env.PLAYWRIGHT_SKIP_BUILD === '1';
const explicitWorkers = process.env.PLAYWRIGHT_WORKERS?.trim();
const parsedWorkers =
  explicitWorkers && /^[0-9]+$/.test(explicitWorkers) ? Number(explicitWorkers) : undefined;
const serverPort = Number(process.env.PLAYWRIGHT_PORT ?? '4173');
const cpuCount = os.cpus().length;
const defaultWorkers = Math.min(4, Math.max(1, cpuCount));
const resolvedWorkers = parsedWorkers ?? defaultWorkers;
const webServerCommand = skipBuild
  ? `${coverageEnv}${probeEnv}npm run preview -- --host 127.0.0.1 --port ${serverPort}`
  : `${coverageEnv}${probeEnv}npm run build && ${coverageEnv}${probeEnv}npm run preview -- --host 127.0.0.1 --port ${serverPort}`;

// Device selection logic
const devicesEnv = process.env.PLAYWRIGHT_DEVICES?.toLowerCase().trim();
const phoneProject = {
  name: 'android-phone',
  use: playwrightDevices['Pixel 5'],
};
const tabletProject = {
  name: 'android-tablet',
  use: {
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 2,
    isMobile: true,
  },
  // Tablet only runs layout-annotated tests by default
  grep: devicesEnv ? undefined : /@layout/,
};

// Determine active projects based on environment variable
const getActiveProjects = () => {
  if (!devicesEnv) {
    // Default: phone for all tests, tablet only for layout tests
    return [phoneProject, tabletProject];
  }

  const normalized = devicesEnv === 'all' ? 'phone,tablet' : devicesEnv;
  const requested = normalized.split(',').map((d) => d.trim());

  const projects = [];
  if (requested.includes('phone')) projects.push(phoneProject);
  if (requested.includes('tablet')) projects.push(tabletProject);

  return projects.length > 0 ? projects : [phoneProject];
};

const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/playwright';
const reportDir = process.env.PLAYWRIGHT_REPORT_DIR || 'playwright-report';

export default defineConfig({
  testDir: './playwright',
  testMatch: ['**/*.spec.ts', '**/*.test.ts', '**/*.fuzz.ts'],
  outputDir,
  preserveOutput: 'always',
  workers: resolvedWorkers,
  timeout: 90000,
  expect: { timeout: 10000 },
  globalTeardown: './playwright/global-teardown-coverage.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: reportDir, open: 'never' }],
  ],
  projects: getActiveProjects(),
  use: {
    baseURL: `http://127.0.0.1:${serverPort}`,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 20000,
    navigationTimeout: 40000,
  },
  webServer: {
    command: webServerCommand,
    url: `http://127.0.0.1:${serverPort}`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 120000,
  },
});
