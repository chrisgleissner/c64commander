import { test as base, type TestInfo } from '@playwright/test';

/**
 * Mark a test as layout-sensitive by adding @layout tag.
 * These tests will run on both phone and tablet profiles.
 * All other tests run only on phone.
 * 
 * Usage: layoutTest('my test @layout', async ({ page }) => { ... });
 */
export const layoutTest = base;

// Kept for backward compatibility with older specs using the helper.
export const enforceDeviceTestMapping = (testInfo: TestInfo) => {
  if (!testInfo.title.includes('@layout')) {
    console.warn(
      `[layoutTest] Test "${testInfo.title}" calls enforceDeviceTestMapping but is missing the @layout tag. ` +
        'Add "@layout" to the test title so grep-based filtering includes it in layout-sensitive runs.'
    );
  }
};
