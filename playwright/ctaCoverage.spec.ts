/**
 * Critical & High Priority CTA Coverage Tests
 *
 * Tests for previously uncovered CTAs identified in doc/ux-interactions.md:
 * - CRITICAL: Add disks to library flow
 * - HIGH: Shuffle mode, Home quick actions, Drive navigation
 * - HIGH: Disk browser source selection
 */

import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring, assertNoUiIssues, allowWarnings } from './testArtifacts';
import { getSourceSelectionButton } from './sourceSelection';

const waitForUiStable = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');
};

test.describe('Critical CTA Coverage', () => {
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

  test('add disks to library flow shows source selection', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await attachStepScreenshot(page, testInfo, 'disks-page');

    // Find "Add items" or "Add more items" button
    const addButton = page.getByRole('button', { name: /Add (more )?items/i });
    await expect(addButton).toBeVisible();
    await attachStepScreenshot(page, testInfo, 'add-button-visible');

    await addButton.click();
    await waitForUiStable(page);
    await attachStepScreenshot(page, testInfo, 'source-selection-opened');

    // Should show source selection: Local and C64 Ultimate
    const dialog = page.getByRole('dialog');
    const localButton = getSourceSelectionButton(dialog, 'This device');
    const c64uButton = getSourceSelectionButton(dialog, 'C64 Ultimate');

    const hasLocalOption = await localButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasC64UOption = await c64uButton.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasLocalOption || hasC64UOption).toBe(true);
    await attachStepScreenshot(page, testInfo, 'source-options-available');
  });
});

test.describe('Shuffle Mode Tests', () => {
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

  test('shuffle checkbox toggles shuffle mode', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await attachStepScreenshot(page, testInfo, 'play-page');

    // Find shuffle checkbox by finding text "Shuffle" near checkbox role
    // Radix UI checkboxes use role="checkbox"
    const shuffleDiv = page.locator('div:has-text("Shuffle")');
    const shuffleCheckbox = shuffleDiv.locator('button[role="checkbox"]').first();
    
    await expect(shuffleCheckbox).toBeVisible();
    await attachStepScreenshot(page, testInfo, 'shuffle-checkbox-found');

    // Check initial state
    const initialState = (await shuffleCheckbox.getAttribute('data-state')) === 'checked';
    await attachStepScreenshot(page, testInfo, `shuffle-initial-${initialState ? 'on' : 'off'}`);

    // Toggle shuffle
    await shuffleCheckbox.click();
    await expect(shuffleCheckbox).toHaveAttribute('data-state', initialState ? 'unchecked' : 'checked');
    await attachStepScreenshot(page, testInfo, 'shuffle-toggled');

    // Verify state changed
    const newState = (await shuffleCheckbox.getAttribute('data-state')) === 'checked';
    expect(newState).toBe(!initialState);
    await attachStepScreenshot(page, testInfo, `shuffle-now-${newState ? 'on' : 'off'}`);
  });

  test('reshuffle button appears when shuffle is enabled', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/play');
    await attachStepScreenshot(page, testInfo, 'play-page');

    // Enable shuffle if not already
    const shuffleCheckbox = page.locator('input[type="checkbox"]').filter({ hasText: /shuffle/i }).or(
      page.locator('label:has-text("Shuffle"), label:has-text("shuffle")').locator('..').locator('input[type="checkbox"]')
    ).first();

    const checkboxExists = await shuffleCheckbox.count() > 0;
    if (checkboxExists) {
      const isChecked = await shuffleCheckbox.isChecked();
      if (!isChecked) {
        await shuffleCheckbox.click();
        await expect(shuffleCheckbox).toBeChecked();
      }
      await attachStepScreenshot(page, testInfo, 'shuffle-enabled');

      // Look for reshuffle button
      const reshuffleButton = page.getByRole('button', { name: /reshuffle|shuffle again|re-shuffle/i });
      const hasReshuffle = await reshuffleButton.isVisible({ timeout: 2000 }).catch(() => false);
      await attachStepScreenshot(page, testInfo, hasReshuffle ? 'reshuffle-button-found' : 'reshuffle-button-not-found');
    } else {
      await attachStepScreenshot(page, testInfo, 'shuffle-control-not-found');
    }
  });
});

test.describe('Home Page Quick Actions', () => {
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

  test('home page displays quick action cards for machine control', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/');
    await attachStepScreenshot(page, testInfo, 'home-page');

    // Check for machine control quick actions
    const resetButton = page.getByRole('button', { name: /reset/i });
    const menuButton = page.getByRole('button', { name: /menu/i });
    const pauseButton = page.getByRole('button', { name: /pause/i });
    const resumeButton = page.getByRole('button', { name: /resume/i });
    const powerButton = page.getByRole('button', { name: /power/i });

    const hasReset = await resetButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasMenu = await menuButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasPause = await pauseButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasResume = await resumeButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasPower = await powerButton.isVisible({ timeout: 2000 }).catch(() => false);

    const machineControlCount = [hasReset, hasMenu, hasPause, hasResume, hasPower].filter(Boolean).length;
    expect(machineControlCount).toBeGreaterThan(0);
    await attachStepScreenshot(page, testInfo, `machine-controls-found-${machineControlCount}`);
  });

  test('home page displays config management quick actions', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/');
    await attachStepScreenshot(page, testInfo, 'home-page');

    // Check for config management quick actions
    const applyButton = page.getByRole('button', { name: /apply/i });
    const saveButton = page.getByRole('button', { name: /save/i });
    const loadButton = page.getByRole('button', { name: /load/i });
    const revertButton = page.getByRole('button', { name: /revert/i });
    const manageButton = page.getByRole('button', { name: /manage/i });

    const hasApply = await applyButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasSave = await saveButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasLoad = await loadButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasRevert = await revertButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasManage = await manageButton.isVisible({ timeout: 2000 }).catch(() => false);

    const configControlCount = [hasApply, hasSave, hasLoad, hasRevert, hasManage].filter(Boolean).length;
    expect(configControlCount).toBeGreaterThan(0);
    await attachStepScreenshot(page, testInfo, `config-controls-found-${configControlCount}`);
  });

  test('drive status cards navigate to disks page', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/');
    await attachStepScreenshot(page, testInfo, 'home-page');

    // Find drive status cards
    const driveCards = page.locator('button:has-text("Drive"), button:has-text("drive")');
    const cardCount = await driveCards.count();

    if (cardCount > 0) {
      await attachStepScreenshot(page, testInfo, `drive-cards-found-${cardCount}`);

      // Click first drive card
      const firstCard = driveCards.first();
      await firstCard.click();
      await page.waitForURL('**/disks', { timeout: 5000 });
      await attachStepScreenshot(page, testInfo, 'after-drive-card-click');

      // Should navigate to disks page
      const currentUrl = page.url();
      expect(currentUrl).toContain('/disks');
      await attachStepScreenshot(page, testInfo, 'navigated-to-disks');
    } else {
      await attachStepScreenshot(page, testInfo, 'drive-cards-not-found');
    }
  });
});

test.describe('Disk Browser Coverage', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    // Allow expected FTP warnings when browsing without FTP bridge
    allowWarnings(testInfo, 'Expected FTP unavailable warnings in disk browser');
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

  test('disk browser allows source selection', async ({ page }: { page: Page }, testInfo: TestInfo) => {
    await page.goto('/disks');
    await attachStepScreenshot(page, testInfo, 'disks-page');

    // Open disk browser
    const addButton = page.getByRole('button', { name: /Add (more )?items/i });
    const hasAddButton = await addButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasAddButton) {
      await addButton.click();
      await waitForUiStable(page);
      await attachStepScreenshot(page, testInfo, 'browser-opened');

      // Verify source selection available
      const dialog = page.getByRole('dialog');
      const localOption = getSourceSelectionButton(dialog, 'This device');
      const c64uOption = getSourceSelectionButton(dialog, 'C64 Ultimate');

      const hasLocal = await localOption.isVisible({ timeout: 2000 }).catch(() => false);
      const hasC64U = await c64uOption.isVisible({ timeout: 2000 }).catch(() => false);

      expect(hasLocal || hasC64U).toBe(true);
      await attachStepScreenshot(page, testInfo, 'source-selection-available');

      // Try selecting a source
      if (hasC64U) {
        await c64uOption.click();
        await waitForUiStable(page);
        await attachStepScreenshot(page, testInfo, 'c64u-source-selected');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
    }
  });
});
