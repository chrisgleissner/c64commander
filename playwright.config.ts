import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  outputDir: 'test-results/playwright',
  preserveOutput: 'always',
  workers: '100%',
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
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
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
