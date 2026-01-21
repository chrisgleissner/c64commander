import { test as base } from './coverage';
import { saveCoverage } from './coverage';

// Auto-save coverage after each test
base.afterEach(async ({ page }, testInfo) => {
  await saveCoverage(page, testInfo.title);
});

export { test, expect } from './coverage';
