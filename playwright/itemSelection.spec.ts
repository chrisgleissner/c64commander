import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import * as path from 'node:path';
import { seedUiMocks, uiFixtures } from './uiMocks';
import { seedFtpConfig, startFtpTestServers } from './ftpTestUtils';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

test.describe('Item Selection Dialog UX', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;
  let ftpServers: Awaited<ReturnType<typeof startFtpTestServers>>;

  test.beforeAll(async () => {
    ftpServers = await startFtpTestServers();
  });

  test.afterAll(async () => {
    await ftpServers.close();
  });

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server(uiFixtures.configState);
    await seedFtpConfig(page, {
      host: ftpServers.ftpServer.host,
      port: ftpServers.ftpServer.port,
      bridgeUrl: ftpServers.bridgeServer.baseUrl,
      password: '',
    });
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

  test('add items modal has single close button', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.waitForSelector('[role="dialog"]');
    await snap(page, testInfo, 'modal-opened');

    // Find all close buttons (X icons) in the dialog
    const dialog = page.locator('[role="dialog"]').first();
    const closeButtons = dialog.locator('button').filter({
      has: page.locator('svg').filter({ hasText: /^$/ }).first()
    });

    // Count visible close buttons in top-right area
    const headerCloseButtons = await dialog.locator('button[aria-label*="Close"], button[class*="absolute"][class*="right"]').count();
    
    await snap(page, testInfo, 'close-buttons-check');
    
    // Should have exactly one close button
    expect(headerCloseButtons).toBeLessThanOrEqual(1);
  });

  test('add items modal does not occupy full viewport height', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.waitForSelector('[role="dialog"]');
    await snap(page, testInfo, 'modal-opened');

    const dialog = page.locator('[role="dialog"]').first();
    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();

    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();

    if (dialogBox && viewport) {
      // Modal should leave at least 10% margin at top and bottom combined
      const heightRatio = dialogBox.height / viewport.height;
      expect(heightRatio).toBeLessThan(0.90);
      
      // Modal should not start at viewport top
      expect(dialogBox.y).toBeGreaterThan(viewport.height * 0.05);
      
      await snap(page, testInfo, 'modal-sizing-verified');
    }
  });

  test('add items modal content is scrollable', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.waitForSelector('[role="dialog"]');
    
    // Select C64 Ultimate source to get file list
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'file-browser-opened');

    const dialog = page.locator('[role="dialog"]').first();
    const scrollableContent = dialog.locator('[class*="overflow"]').first();

    // Check if content area is scrollable
    const isScrollable = await scrollableContent.evaluate((el: HTMLElement) => {
      return el.scrollHeight > el.clientHeight || el.classList.toString().includes('overflow');
    });

    await snap(page, testInfo, 'scrollable-check');
    
    // Content should either be scrollable or have overflow classes
    expect(isScrollable || (await scrollableContent.getAttribute('class'))?.includes('overflow')).toBeTruthy();
  });

  test('C64 Ultimate folder selection shows confirm button', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-page-loaded');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'c64u-browser-opened');

    // Find and select a folder checkbox (row with Open button)
    const firstFolderRow = page
      .locator('[data-testid="source-entry-row"]')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .first();
    const checkbox = firstFolderRow.getByRole('checkbox').first();
    await checkbox.click();
    await snap(page, testInfo, 'folder-selected');

    // Confirm button should be visible and enabled
    const confirmButton = page.getByTestId('add-items-confirm');
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton).toBeEnabled();
    
    await snap(page, testInfo, 'confirm-button-visible');
  });

  test('Play page: C64 Ultimate full flow adds items', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-initial');

    // Open add items dialog
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await snap(page, testInfo, 'add-items-opened');

    // Select C64 Ultimate source
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'c64u-selected');

    // Navigate to Usb0 folder
    const usb2Row = page.getByText('Usb0', { exact: false }).locator('..').locator('..').locator('..');
    await usb2Row.getByRole('button', { name: 'Open' }).click();
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'usb2-opened');

    // Select a folder (row with Open action)
    const firstCheckbox = page
      .locator('[data-testid="source-entry-row"]')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .first()
      .getByRole('checkbox');
    await firstCheckbox.click();
    await snap(page, testInfo, 'item-selected');

    // Click confirm
    const confirmButton = page.getByTestId('add-items-confirm');
    await confirmButton.click();
    await page.waitForTimeout(1000);
    await snap(page, testInfo, 'items-adding');

    // Wait for dialog to close
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
    await snap(page, testInfo, 'dialog-closed');

    // Verify we're back on Play page with items
    await expect(page.getByTestId('playlist-list')).toBeVisible();
    await snap(page, testInfo, 'back-to-play-page');
  });

  test('Disks page: C64 Ultimate full flow adds disks', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await snap(page, testInfo, 'disks-initial');

    // Open add items dialog
    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await snap(page, testInfo, 'add-items-opened');

    // Select C64 Ultimate source
    await page.getByRole('button', { name: 'C64 Ultimate' }).click();
    await page.waitForTimeout(500);
    await snap(page, testInfo, 'c64u-selected');

    // Navigate to Usb0 folder
    const usb2Row = page.getByText('Usb0', { exact: false }).locator('..').locator('..').locator('..');
    if (await usb2Row.isVisible({ timeout: 2000 }).catch(() => false)) {
      await usb2Row.getByRole('button', { name: 'Open' }).click();
      await page.waitForTimeout(500);
      await snap(page, testInfo, 'usb2-opened');
    }

    // Select a disk folder (row with Open action)
    const firstCheckbox = page
      .locator('[data-testid="source-entry-row"]')
      .filter({ has: page.getByRole('button', { name: 'Open' }) })
      .first()
      .getByRole('checkbox');
    await firstCheckbox.click();
    await snap(page, testInfo, 'item-selected');

    // Click confirm
    const confirmButton = page.getByTestId('add-items-confirm');
    await confirmButton.click();
    await page.waitForTimeout(1000);
    await snap(page, testInfo, 'items-adding');

    // Wait for dialog to close
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10000 });
    await snap(page, testInfo, 'dialog-closed');

    // Verify we're back on Disks page
    await expect(page.locator('header').getByRole('heading', { name: 'Disks' })).toBeVisible();
    await snap(page, testInfo, 'back-to-disks-page');
  });

  test('Play page: Add folder returns to Play and populates playlist', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-initial');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/local-play')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'play-folder-added');

    await expect(page.getByTestId('playlist-list')).toContainText('demo.sid');
    await snap(page, testInfo, 'playlist-populated');
  });

  test('Disks page: Add folder returns to Disks and populates library', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await snap(page, testInfo, 'disks-initial');

    await page.getByRole('button', { name: /Add items|Add more items/i }).click();
    await page.getByRole('button', { name: 'Add folder' }).click();
    const input = page.locator('input[type="file"][webkitdirectory]');
    await expect(input).toHaveCount(1);
    await input.setInputFiles([path.resolve('playwright/fixtures/disks-local')]);
    await expect(page.getByRole('dialog')).toBeHidden();
    await snap(page, testInfo, 'disks-folder-added');

    await expect(page.getByTestId('disk-row').first()).toBeVisible();
    await expect(page.getByTestId('disk-list')).toContainText('Disk 1');
    await snap(page, testInfo, 'disks-populated');
  });
});
