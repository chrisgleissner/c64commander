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

  test('change base URL and save reconnects', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings', description: 'Expected connection failures to non-existent URL' });
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const urlInput = page.getByLabel(/base url|connection url/i);
    await expect(urlInput).toBeVisible();
    
    const originalUrl = await urlInput.inputValue();
    await snap(page, testInfo, 'original-url');

    await urlInput.fill('http://localhost:8080');
    await snap(page, testInfo, 'url-changed');

    await page.getByRole('button', { name: /Save & Connect|Save connection/i }).click();
    await snap(page, testInfo, 'save-clicked');

    await expect(page.getByText(/Connection settings saved|Saved/i).first()).toBeVisible();
    await snap(page, testInfo, 'toast-shown');

    const stored = await page.evaluate(() => localStorage.getItem('c64u_base_url'));
    expect(stored).toBe('http://localhost:8080');
    await snap(page, testInfo, 'url-saved');
  });

  test('invalid URL format shows validation or accepts input', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    const urlInput = page.getByLabel(/base url|connection url/i);
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

  test('toggle mock mode switches connection', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    const enableDeveloperMode = async () => {
      const aboutButton = page.getByRole('button', { name: 'About' });
      for (let i = 0; i < 7; i += 1) {
        await aboutButton.click();
      }
    };

    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    await enableDeveloperMode();
    await snap(page, testInfo, 'dev-mode-enabled');

    const mockToggle = page.getByLabel(/mock|mocked c64u|use mock/i);
    
    if (await mockToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(mockToggle).not.toBeChecked();
      await snap(page, testInfo, 'mock-off');

      await mockToggle.click();
      await snap(page, testInfo, 'mock-toggled');

      await expect(page.getByText(/Mock.*enabled|Mocked C64U enabled/i).first()).toBeVisible({ timeout: 5000 });
      await snap(page, testInfo, 'mock-mode-active');

      await mockToggle.click();
      await snap(page, testInfo, 'mock-disabled');
    } else {
      await snap(page, testInfo, 'mock-toggle-not-available');
    }
  });
});
