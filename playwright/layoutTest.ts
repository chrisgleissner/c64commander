import { test as base, type TestInfo } from '@playwright/test';

/**
 * Mark a test as layout-sensitive by adding @layout tag.
 * These tests will run on both phone and tablet profiles.
 * All other tests run only on phone.
 * 
 * Usage: layoutTest('my test @layout', async ({ page }) => { ... });
 */
export const layoutTest = base;

// No longer needed with grep-based filtering
export const enforceDeviceTestMapping = (testInfo: TestInfo) => {
  // This function is now a no-op but kept for backward compatibility
  void testInfo;
};
