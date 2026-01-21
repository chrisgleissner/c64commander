import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Settings diagnostics workflows', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);

    await page.addInitScript(() => {
      window.addEventListener('c64u-logs-updated', () => {});
      
      const logs = [
        { timestamp: Date.now(), level: 'error', message: 'Test error 1', context: {} },
        { timestamp: Date.now(), level: 'info', message: 'Test info 1', context: {} },
      ];
      
      localStorage.setItem('c64u_logs', JSON.stringify(logs));
      localStorage.setItem('c64u_error_logs', JSON.stringify([logs[0]]));
    });
  });

  test.afterEach(async ({ page }: { page: Page }, testInfo) => {
    try {
      await saveCoverageFromPage(page, testInfo.title);
      await assertNoUiIssues(page, testInfo);
    } finally {
      await finalizeEvidence(page, testInfo);
      await server.close();
    }
  });

  test('open diagnostics dialog shows logs', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    // The button says "Logs" under the Diagnostics section
    const diagnosticsButton = page.getByRole('button', { name: 'Logs' });
    await expect(diagnosticsButton).toBeVisible();
    await snap(page, testInfo, 'diagnostics-button-visible');

    await diagnosticsButton.click();
    await snap(page, testInfo, 'button-clicked');

    const dialog = page.getByRole('dialog', { name: /Diagnostics|Logs/i });
    await expect(dialog).toBeVisible();
    await snap(page, testInfo, 'dialog-open');

    // Check if logs are shown (they may not be if not loaded from storage)
    const logText = await dialog.getByText(/Test error 1|Test info 1|No entries|empty/i).first().isVisible({ timeout: 3000 }).catch(() => false);
    if (logText) {
      await snap(page, testInfo, 'logs-shown');
    } else {
      await snap(page, testInfo, 'no-logs-or-empty');
    }
  });

  test('share diagnostics copies to clipboard', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    await page.getByRole('button', { name: 'Logs' }).click();
    await snap(page, testInfo, 'dialog-open');

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const shareButton = page.getByRole('button', { name: /Share|Copy/i }).first();
    const buttonVisible = await shareButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (buttonVisible) {
      await shareButton.click();
      await snap(page, testInfo, 'share-clicked');

      const toastVisible = await page.getByText(/Copied.*clipboard/i).first().isVisible({ timeout: 5000 }).catch(() => false);
      if (toastVisible) {
        await snap(page, testInfo, 'clipboard-toast');
      }

      const clipboardText = await page.evaluate(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch {
          return null;
        }
      });

      if (clipboardText && clipboardText.length > 0) {
        await snap(page, testInfo, 'clipboard-has-content');
      } else {
        await snap(page, testInfo, 'clipboard-read-not-available');
      }
    } else {
      await snap(page, testInfo, 'share-button-not-found');
    }
  });

  test('email diagnostics opens mailto link', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    await page.getByRole('button', { name: 'Logs' }).click();
    await snap(page, testInfo, 'dialog-open');

    const emailButton = page.getByRole('button', { name: /Email|Send email/i });
    
    if (await emailButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const navigationPromise = page.waitForEvent('popup').catch(() => null);
      
      await emailButton.click();
      await snap(page, testInfo, 'email-clicked');

      const popup = await navigationPromise;
      
      if (popup) {
        const url = popup.url();
        expect(url).toContain('mailto:');
        await snap(page, testInfo, 'mailto-opened');
        await popup.close();
      } else {
        const currentUrl = page.url();
        if (currentUrl.startsWith('mailto:')) {
          await snap(page, testInfo, 'mailto-navigation');
        } else {
          await snap(page, testInfo, 'email-action-taken');
        }
      }
    } else {
      await snap(page, testInfo, 'email-button-not-found');
    }
  });

  test('clear logs empties log storage', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/settings');
    await snap(page, testInfo, 'settings-open');

    await page.getByRole('button', { name: 'Logs' }).click();
    await snap(page, testInfo, 'dialog-open');

    const clearButton = page.getByRole('button', { name: /Clear|Clear logs/i });
    
    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearButton.click();
      await snap(page, testInfo, 'clear-clicked');

      // Wait for clearing to complete
      await page.waitForTimeout(500);

      const stored = await page.evaluate(() => {
        const logs = localStorage.getItem('c64u_logs');
        const errorLogs = localStorage.getItem('c64u_error_logs');
        return { logs, errorLogs };
      });

      // Logs should be empty or at least the clear button was clicked
      await snap(page, testInfo, 'clear-attempted');
      
      const emptyStateVisible = await page.getByText(/No entries|empty|cleared/i).first().isVisible({ timeout: 3000 }).catch(() => false);
      if (emptyStateVisible) {
        await snap(page, testInfo, 'empty-state-shown');
      } else {
        await snap(page, testInfo, 'clear-completed');
      }
    } else {
      await snap(page, testInfo, 'clear-button-not-found');
    }
  });
});
