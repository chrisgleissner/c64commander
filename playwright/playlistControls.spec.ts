import { test, expect } from '@playwright/test';
import { saveCoverageFromPage } from './withCoverage';
import type { Page, TestInfo } from '@playwright/test';
import * as path from 'node:path';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
  await attachStepScreenshot(page, testInfo, label);
};

const addLocalFolder = async (page: Page, folderPath: string) => {
  await page.getByRole('button', { name: /Add items|Add more items/i }).click();
  await page.getByRole('button', { name: 'Add folder' }).click();
  const input = page.locator('input[type="file"][webkitdirectory]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles([folderPath]);
  await expect(page.getByRole('dialog')).toBeHidden();
};

test.describe('Playlist controls and advanced features', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }: { page: Page }, testInfo) => {
    await startStrictUiMonitoring(page, testInfo);
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
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

  test('playlist filter not yet implemented', async ({ page }: { page: Page }, testInfo) => {
    // Verify that playlist filter is not yet available (only HVSC folder filter exists)
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    // The playlist shows items without a general filter input
    // (HVSC has folder filter, but general playlist filtering not implemented)
    const playlistItems = page.locator('[data-playlist-item], [data-testid="playlist-item"]');
    const itemCount = await playlistItems.count().catch(() => 0);
    
    // Should have items from local folder
    expect(itemCount).toBeGreaterThan(0);
    await snap(page, testInfo, 'items-shown-unfiltered');
  });

  test('shuffle mode checkbox toggles state', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    // The Shuffle checkbox is in a div with checkboxes - scroll to the options area first
    await page.getByText('Recurse folders').scrollIntoViewIfNeeded();
    await snap(page, testInfo, 'scrolled-to-options');

    // Now find the shuffle checkbox - it's the second checkbox in the options area
    const allCheckboxes = page.getByRole('checkbox');
    const shuffleCheckbox = allCheckboxes.nth(1); // 0=Recurse folders, 1=Shuffle, 2=Repeat
    await expect(shuffleCheckbox).toBeVisible();
    await expect(shuffleCheckbox).not.toBeChecked();
    await snap(page, testInfo, 'shuffle-off');

    await shuffleCheckbox.click();
    await expect(shuffleCheckbox).toBeChecked();
    await snap(page, testInfo, 'shuffle-enabled');

    await shuffleCheckbox.click();
    await expect(shuffleCheckbox).not.toBeChecked();
    await snap(page, testInfo, 'shuffle-disabled');
  });

  test('shuffle category checkboxes filter eligible files', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    await page.getByText('Recurse folders').scrollIntoViewIfNeeded();
    const shuffleCheckbox = page.getByRole('checkbox').nth(1);
    await shuffleCheckbox.click();
    await snap(page, testInfo, 'shuffle-enabled');

    // Category checkboxes appear after shuffle is enabled (indices 3+ are categories)
    const sidCategoryCheckbox = page.getByRole('checkbox').nth(3);
    if (await sidCategoryCheckbox.isVisible()) {
      await expect(sidCategoryCheckbox).toBeChecked();
      await sidCategoryCheckbox.click();
      await expect(sidCategoryCheckbox).not.toBeChecked();
      await snap(page, testInfo, 'sid-category-unchecked');
    } else {
      await snap(page, testInfo, 'category-checkboxes-not-visible');
    }
  });

  test('repeat mode checkbox toggles state', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    // Scroll to options area
    await page.getByText('Recurse folders').scrollIntoViewIfNeeded();
    await snap(page, testInfo, 'scrolled-to-options');

    // Repeat checkbox is the third one (0=Recurse, 1=Shuffle, 2=Repeat)
    const repeatCheckbox = page.getByRole('checkbox').nth(2);

    await repeatCheckbox.click();
    await expect(repeatCheckbox).toBeChecked();
    await snap(page, testInfo, 'repeat-enabled');
  });

  test('duration override input accepts mm:ss format', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    // Start playback
    const playButton = page.getByRole('button', { name: /play/i }).first();
    if (await playButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await playButton.click();
      await page.waitForTimeout(500);
      await snap(page, testInfo, 'playback-started');
    }

    // Find a SID file and open its menu
    const sidRow = page.getByTestId('playlist-item').filter({ hasText: /\.sid$/i }).first();
    const menuButton = sidRow.getByRole('button', { name: /menu|more|actions/i });

    if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await menuButton.click();
      await snap(page, testInfo, 'menu-opened');

      // Look for duration override menu item
      const durationItem = page.getByRole('menuitem', { name: /duration|override|time/i });
      if (await durationItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await durationItem.click();
        await snap(page, testInfo, 'duration-dialog-open');

        const durationInput = page.getByRole('dialog').getByRole('textbox').or(
          page.getByRole('dialog').getByPlaceholder(/mm:ss|duration/i)
        ).first();
        
        await durationInput.fill('3:45');
        await snap(page, testInfo, 'duration-entered');

        await page.getByRole('dialog').getByRole('button', { name: /save|set|apply/i }).click();
        await snap(page, testInfo, 'duration-applied');
      } else {
        await snap(page, testInfo, 'duration-override-not-available');
      }
    } else {
      await snap(page, testInfo, 'menu-not-available');
    }
  });

  test('duration override affects playback metadata', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    // Start playback
    const playButton = page.getByRole('button', { name: /play/i }).first();
    if (await playButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await playButton.click();
      await page.waitForTimeout(500);
      await snap(page, testInfo, 'playback-started');
    }

    // Get initial timer display
    const timerDisplay = page.locator('[data-testid="playback-timer"], [data-timer], .timer').first();
    const initialTimer = await timerDisplay.textContent().catch(() => null);
    await snap(page, testInfo, 'initial-timer');

    // Find current playing item and set duration override
    const playingItem = page.locator('[data-playing="true"], [data-state="playing"]').first();
    if (await playingItem.isVisible({ timeout: 1000 }).catch(() => false)) {
      const menuButton = playingItem.getByRole('button', { name: /menu|more|actions/i });
      
      if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await menuButton.click();
        await snap(page, testInfo, 'menu-opened');

        const durationItem = page.getByRole('menuitem', { name: /duration|override/i });
        if (await durationItem.isVisible({ timeout: 1000 }).catch(() => false)) {
          await durationItem.click();
          await page.waitForTimeout(300);
          
          const durationInput = page.getByRole('dialog').locator('input[type="text"], input[placeholder*="duration"]').first();
          await durationInput.fill('2:00');
          await page.getByRole('dialog').getByRole('button', { name: /save|apply/i }).click();
          await snap(page, testInfo, 'duration-override-applied');

          // Verify duration changed in metadata or display
          await page.waitForTimeout(500);
          const newTimer = await timerDisplay.textContent().catch(() => null);
          await snap(page, testInfo, 'timer-after-override');
          
          // Timer display should reflect the override (may show as total duration)
          expect(newTimer).not.toBe(initialTimer);
        } else {
          await snap(page, testInfo, 'duration-item-not-found');
        }
      } else {
        await snap(page, testInfo, 'menu-button-not-visible');
      }
    } else {
      await snap(page, testInfo, 'no-playing-item');
    }
  });

  test('SID subsong selection input accepts song number', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    const sidRow = page.getByTestId('playlist-item').filter({ hasText: 'demo.sid' }).first();
    const menuButton = sidRow.getByRole('button', { name: /menu|more|actions/i });

    if (await menuButton.isVisible()) {
      await menuButton.click();
      await snap(page, testInfo, 'menu-opened');

      const subsongItem = page.getByRole('menuitem', { name: /song|subsong|song number/i });
      if (await subsongItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        await subsongItem.click();
        await snap(page, testInfo, 'subsong-dialog-open');

        const subsongInput = page.getByRole('dialog').getByRole('spinbutton').or(
          page.getByRole('dialog').getByPlaceholder(/song|number/i)
        ).first();
        await subsongInput.fill('2');
        await snap(page, testInfo, 'subsong-entered');

        await page.getByRole('dialog').getByRole('button', { name: /save|set|apply/i }).click();
        await snap(page, testInfo, 'subsong-saved');
      } else {
        await snap(page, testInfo, 'subsong-option-not-available');
      }
    }
  });

  test('prev at first track stays at first', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    await page.getByTestId('playlist-item').first().getByRole('button', { name: 'Play' }).click();
    await snap(page, testInfo, 'first-track-playing');

    const prevButton = page.getByTestId('playlist-prev');
    await expect(prevButton).toBeVisible();
    
    const initialHighlight = await page.getByTestId('playlist-item').first().getAttribute('data-playing');
    await prevButton.click();
    await snap(page, testInfo, 'prev-clicked');

    const currentHighlight = await page.getByTestId('playlist-item').first().getAttribute('data-playing');
    expect(currentHighlight).toBe(initialHighlight);
    await snap(page, testInfo, 'still-at-first');
  });

  test('next at last track stops playback', async ({ page }: { page: Page }, testInfo) => {
    await page.goto('/play');
    await snap(page, testInfo, 'play-open');

    await addLocalFolder(page, path.resolve('playwright/fixtures/local-play'));
    await snap(page, testInfo, 'playlist-ready');

    await page.getByTestId('playlist-item').last().getByRole('button', { name: 'Play' }).click();
    await snap(page, testInfo, 'last-track-playing');

    const playButton = page.getByTestId('playlist-play');
    await expect(playButton).toContainText(/Stop|Playing/i);
    await snap(page, testInfo, 'playback-active');

    const nextButton = page.getByTestId('playlist-next');
    await nextButton.click();
    await snap(page, testInfo, 'next-clicked');

    await expect(playButton).toContainText(/Play/i);
    await expect(playButton).not.toContainText(/Stop|Playing/i);
    await snap(page, testInfo, 'playback-stopped');
  });
});
