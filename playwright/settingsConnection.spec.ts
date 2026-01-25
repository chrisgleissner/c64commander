import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { allowWarnings, assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Settings connection management', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('change device host and save reconnects', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings', description: 'Expected connection failures to non-existent URL' });
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const urlInput = page.locator('#deviceHost');
    await expect(urlInput).toBeVisible();
    
    const originalUrl = await urlInput.inputValue();
    await snap(page, testInfo, 'original-url');

    await urlInput.fill('localhost:8080');
    await snap(page, testInfo, 'url-changed');

    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    await snap(page, testInfo, 'save-clicked');

    await expect(page.getByText(/Connection settings saved|Saved/i).first()).toBeVisible();
    await snap(page, testInfo, 'toast-shown');

    const stored = await page.evaluate(() => localStorage.getItem('c64u_device_host'));
    expect(stored).toBe('localhost:8080');
    await snap(page, testInfo, 'url-saved');
  });

  test('invalid host format shows validation or accepts input', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    allowWarnings(testInfo, 'Expected connection failures to invalid URL.');
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const urlInput = page.locator('#deviceHost');
    await expect(urlInput).toBeVisible();

    await urlInput.fill('not-a-valid-url');
    await snap(page, testInfo, 'invalid-url-entered');

    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    await snap(page, testInfo, 'save-attempted');

    const hasError = await page.getByText(/invalid|error|failed/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    
    if (hasError) {
      await snap(page, testInfo, 'validation-shown');
    } else {
      await snap(page, testInfo, 'no-validation-accepts-any-input');
    }
  });

  test('change password stores in localStorage', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const passwordInput = page.getByLabel(/password|network password/i);
    await expect(passwordInput).toBeVisible();
    await snap(page, testInfo, 'password-field-visible');

    await passwordInput.fill('test-password-123');
    await snap(page, testInfo, 'password-entered');

    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    await snap(page, testInfo, 'save-clicked');

    await expect(page.getByText(/Connection settings saved|Saved/i).first()).toBeVisible();
    await snap(page, testInfo, 'toast-shown');

    const stored = await page.evaluate(() => localStorage.getItem('c64u_password'));
    expect(stored).toBe('test-password-123');
    await snap(page, testInfo, 'password-saved');
  });

  test('select light theme applies theme class', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const lightThemeButton = page.getByRole('button', { name: /Light|light theme/i }).first();
    await expect(lightThemeButton).toBeVisible();
    await snap(page, testInfo, 'light-button-visible');

    await lightThemeButton.click();
    await snap(page, testInfo, 'light-selected');

    const htmlClass = await page.locator('html').getAttribute('class');
    const isLight = htmlClass?.includes('light') || !htmlClass?.includes('dark');
    expect(isLight).toBe(true);
    await snap(page, testInfo, 'light-theme-applied');
  });

  test('select dark theme applies theme class', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const darkThemeButton = page.getByRole('button', { name: /Dark|dark theme/i }).first();
    await expect(darkThemeButton).toBeVisible();
    await snap(page, testInfo, 'dark-button-visible');

    await darkThemeButton.click();
    await snap(page, testInfo, 'dark-selected');

    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
    await snap(page, testInfo, 'dark-theme-applied');
  });

  test('automatic demo mode toggle is visible and persisted', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const autoDemoToggle = page.getByLabel(/automatic demo mode/i);
    await expect(autoDemoToggle).toBeVisible();
    await expect(autoDemoToggle).toBeChecked();
    await snap(page, testInfo, 'auto-demo-default-on');

    await autoDemoToggle.click();
    await expect(autoDemoToggle).not.toBeChecked();
    await snap(page, testInfo, 'auto-demo-off');

    const storedOff = await page.evaluate(() => localStorage.getItem('c64u_automatic_demo_mode_enabled'));
    expect(storedOff).toBe('0');

    await autoDemoToggle.click();
    await expect(autoDemoToggle).toBeChecked();
    await snap(page, testInfo, 'auto-demo-on');

    const storedOn = await page.evaluate(() => localStorage.getItem('c64u_automatic_demo_mode_enabled'));
    expect(storedOn).toBe('1');
  });

  test('settings sections appear in expected order', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('c64u_dev_mode_enabled', '1');
    });

    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const headings = await page.locator('h2').allTextContents();
    expect(headings).toEqual([
      'Connection',
      'Diagnostics',
      'Appearance',
      'Play and Disk',
      'Config',
      'Experimental',
      'About',
    ]);
  });
});
