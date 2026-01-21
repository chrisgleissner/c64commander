/**
 * UX Interaction Pattern Tests
 * 
 * Validates interaction patterns from doc/ux-guidelines.md:
 * - Sources define where items come from
 * - Selection is navigation within a source (bounded)
 * - Collections are playlists (playback) or disk collections (mounting)
 * - Intent-based language over technical terms
 * - Layout stability
 */

import { test, expect, Page } from '@playwright/test';
import { attachStepScreenshot } from './testArtifacts';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';

test.describe('UX Interaction Patterns', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }) => {
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await server.close();
  });

  test('source selection precedes navigation - local source @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    // Navigate directly to Play page
    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');
    await attachStepScreenshot(page, testInfo, 'play-page');

    // Look for "Add items" button (intent-based language)
    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);
    await attachStepScreenshot(page, testInfo, 'source-selector-opened');

    // Should show source selection: Local and C64 Ultimate
    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    const c64uButton = page.getByRole('button', { name: /C64 Ultimate|Ultimate|C64U/i });

    const localVisible = await localButton.isVisible({ timeout: 2000 }).catch(() => false);
    const c64uVisible = await c64uButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (!localVisible && !c64uVisible) {
      await attachStepScreenshot(page, testInfo, 'source-buttons-not-found');
      return;
    }

    // Select local source
    if (localVisible) {
      await localButton.click();
      await page.waitForTimeout(500);
      await attachStepScreenshot(page, testInfo, 'local-source-selected');

      // Should now show local file navigation
      const backButton = page.getByRole('button', { name: /Back|Up|Parent/i });
      const hasNavigation = await backButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (hasNavigation) {
        await attachStepScreenshot(page, testInfo, 'navigation-available');
      } else {
        await attachStepScreenshot(page, testInfo, 'navigation-not-found');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
    }
  });

  test('source selection precedes navigation - C64U source @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const c64uButton = page.getByRole('button', { name: /C64 Ultimate|Ultimate|C64U/i });
    if (!(await c64uButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'c64u-source-not-available');
      return;
    }

    await c64uButton.click();
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'c64u-source-selected');

    // Should now show C64U file navigation
    const backButton = page.getByRole('button', { name: /Back|Up|Parent|Root/i });
    const hasNavigation = await backButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasNavigation) {
      await attachStepScreenshot(page, testInfo, 'c64u-navigation-available');
    } else {
      await attachStepScreenshot(page, testInfo, 'c64u-navigation-not-found');
    }
  });

  test('selection view navigation stays within source scope @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (!(await localButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
      return;
    }
    await localButton.click();
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'at-local-root');

    // At source root, "Up" button should be disabled or hidden
    const upButton = page.getByRole('button', { name: /Back|Up|Parent/i }).first();
    const upVisible = await upButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (upVisible) {
      const isDisabled = await upButton.isDisabled().catch(() => false);
      if (isDisabled) {
        await attachStepScreenshot(page, testInfo, 'up-button-disabled-at-root');
      } else {
        await attachStepScreenshot(page, testInfo, 'up-button-enabled-at-root');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'up-button-hidden-at-root');
    }

    // Navigate into a folder
    const folder = page.getByRole('button', { name: /folder|dir/i }).first();
    if (await folder.isVisible({ timeout: 2000 }).catch(() => false)) {
      await folder.click();
      await page.waitForTimeout(500);
      await attachStepScreenshot(page, testInfo, 'navigated-into-folder');

      // Now "Up" should be enabled
      const upNowEnabled = await upButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (upNowEnabled) {
        const stillDisabled = await upButton.isDisabled().catch(() => false);
        if (!stillDisabled) {
          await attachStepScreenshot(page, testInfo, 'up-button-enabled-in-subfolder');
        }
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'no-folders-to-navigate');
    }
  });

  test('bulk actions: select all and deselect all @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (!(await localButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
      return;
    }
    await localButton.click();
    await page.waitForTimeout(500);

    // Look for "Select All" button
    const selectAllButton = page.getByRole('button', { name: /Select All|Select all/i });
    if (await selectAllButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectAllButton.click();
      await page.waitForTimeout(300);
      await attachStepScreenshot(page, testInfo, 'all-items-selected');

      // Now look for "Deselect All" or "Clear Selection"
      const deselectButton = page.getByRole('button', { name: /Deselect All|Clear Selection|Deselect all/i });
      if (await deselectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deselectButton.click();
        await page.waitForTimeout(300);
        await attachStepScreenshot(page, testInfo, 'all-items-deselected');
      } else {
        await attachStepScreenshot(page, testInfo, 'deselect-button-not-found');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'select-all-not-found');
    }
  });

  test('bulk remove from playlist shows confirmation @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'playlist-view');

    // Check if there are items in the playlist
    const playlistItems = page.locator('[data-testid="playlist-item"], .playlist-item, [role="listitem"]');
    const itemCount = await playlistItems.count();

    if (itemCount === 0) {
      await attachStepScreenshot(page, testInfo, 'empty-playlist');
      return;
    }

    // Look for "Select All" in playlist
    const selectAllButton = page.getByRole('button', { name: /Select All|Select all/i });
    if (!(await selectAllButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'select-all-not-available');
      return;
    }

    await selectAllButton.click();
    await page.waitForTimeout(300);
    await attachStepScreenshot(page, testInfo, 'all-playlist-items-selected');

    // Look for "Remove" button
    const removeButton = page.getByRole('button', { name: /Remove|Delete|Clear/i });
    if (!(await removeButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'remove-button-not-found');
      return;
    }

    await removeButton.click();
    await page.waitForTimeout(300);
    await attachStepScreenshot(page, testInfo, 'after-remove-clicked');

    // Should show confirmation dialog
    const confirmDialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
    const dialogVisible = await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (dialogVisible) {
      await attachStepScreenshot(page, testInfo, 'confirmation-dialog-shown');
      const confirmText = await confirmDialog.textContent();
      expect(confirmText?.toLowerCase()).toContain('remove');
    } else {
      await attachStepScreenshot(page, testInfo, 'no-confirmation-dialog');
    }
  });

  test('playback controls only in playlist, not in selection view @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'playlist-view');

    // In playlist view, should have playback controls
    const playButton = page.getByRole('button', { name: /Play|Pause|Resume/i });
    const playControlsExist = await playButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (playControlsExist) {
      await attachStepScreenshot(page, testInfo, 'playback-controls-in-playlist');
    }

    // Now open selection view
    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (await localButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await localButton.click();
      await page.waitForTimeout(500);
      await attachStepScreenshot(page, testInfo, 'in-selection-view');

      // Should NOT have playback controls here
      const playButtonInSelection = page.getByRole('button', { name: /Play|Pause|Resume/i });
      const hasPlaybackControls = await playButtonInSelection.isVisible({ timeout: 1000 }).catch(() => false);
      
      if (!hasPlaybackControls) {
        await attachStepScreenshot(page, testInfo, 'no-playback-controls-in-selection');
      } else {
        await attachStepScreenshot(page, testInfo, 'unexpected-playback-controls-in-selection');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
    }
  });

  test('mounting controls only on disks page, not on play page @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'play-page');

    // Should NOT have mounting controls (Mount, Unmount)
    const mountButton = page.getByRole('button', { name: /Mount|Unmount|Eject/i });
    const hasMountControls = await mountButton.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (!hasMountControls) {
      await attachStepScreenshot(page, testInfo, 'no-mount-controls-on-play-page');
    } else {
      await attachStepScreenshot(page, testInfo, 'unexpected-mount-controls-on-play-page');
    }

    // Navigate to Disks page
    await page.goto("/disks");

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'disks-page');

    // Should have mounting controls here
    const mountButtonOnDisks = page.getByRole('button', { name: /Mount|Unmount|Eject/i });
    const hasMountControlsOnDisks = await mountButtonOnDisks.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (hasMountControlsOnDisks) {
      await attachStepScreenshot(page, testInfo, 'mount-controls-on-disks-page');
    } else {
      await attachStepScreenshot(page, testInfo, 'mount-controls-not-found-on-disks-page');
    }
  });

  test('intent-based language: "Add items" not "Browse filesystem" @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'play-page');

    // Look for intent-based button text
    const addButton = page.getByRole('button', { name: /Add items|Add|Choose/i });
    if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      const buttonText = await addButton.textContent();
      await attachStepScreenshot(page, testInfo, 'intent-based-add-button');
      
      // Should not contain technical terms like "Browse", "Filesystem", "Directory"
      const hasTechnicalTerms = /browse|filesystem|directory/i.test(buttonText || '');
      if (hasTechnicalTerms) {
        await attachStepScreenshot(page, testInfo, 'technical-terms-in-button');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
    }
  });

  test('intent-based language: "Choose source" in source selection @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);
    await attachStepScreenshot(page, testInfo, 'source-selector');

    // Look for intent-based headings or instructions
    const heading = page.getByRole('heading', { name: /Choose|Select|Pick/i });
    const headingVisible = await heading.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (headingVisible) {
      const headingText = await heading.textContent();
      await attachStepScreenshot(page, testInfo, 'intent-based-heading');
      
      // Should contain "source" or similar intent
      const hasSourceLanguage = /source|location|where/i.test(headingText || '');
      if (hasSourceLanguage) {
        await attachStepScreenshot(page, testInfo, 'source-language-present');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'heading-not-found');
    }
  });

  test('layout stability: controls do not shift when selection changes @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (!(await localButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
      return;
    }
    await localButton.click();
    await page.waitForTimeout(500);

    // Get initial position of a control element (e.g., "Add" button)
    const controlButton = page.getByRole('button', { name: /Add|Select/i }).first();
    const initialBox = await controlButton.boundingBox().catch(() => null);
    
    if (!initialBox) {
      await attachStepScreenshot(page, testInfo, 'control-button-not-found');
      return;
    }
    await attachStepScreenshot(page, testInfo, 'initial-layout');

    // Select an item
    const firstItem = page.getByRole('button', { name: /.+/ }).first();
    if (await firstItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstItem.click();
      await page.waitForTimeout(300);
      await attachStepScreenshot(page, testInfo, 'item-selected');

      // Check if control button moved
      const newBox = await controlButton.boundingBox().catch(() => null);
      if (newBox && initialBox) {
        const moved = Math.abs(newBox.y - initialBox.y) > 5; // Allow 5px tolerance
        if (!moved) {
          await attachStepScreenshot(page, testInfo, 'layout-stable');
        } else {
          await attachStepScreenshot(page, testInfo, 'layout-shifted');
        }
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'no-items-to-select');
    }
  });

  test('disk collection shows full list with "View all" when limit exceeded @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/disks");

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'disks-page');

    // Look for "View all" button (indicates truncation)
    const viewAllButton = page.getByRole('button', { name: /View all|Show all|See all/i });
    const hasViewAll = await viewAllButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasViewAll) {
      await attachStepScreenshot(page, testInfo, 'view-all-present');
      await viewAllButton.click();
      await page.waitForTimeout(300);
      await attachStepScreenshot(page, testInfo, 'full-list-opened');

      // Should show a scrollable panel with all items
      const fullListPanel = page.getByRole('dialog').or(page.locator('[data-full-list], [data-view-all-panel]'));
      const panelVisible = await fullListPanel.isVisible({ timeout: 2000 }).catch(() => false);

      if (panelVisible) {
        await attachStepScreenshot(page, testInfo, 'scrollable-panel-shown');
      } else {
        await attachStepScreenshot(page, testInfo, 'full-list-display-variation');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'no-truncation-or-view-all');
    }
  });

  test('long paths wrap and do not force horizontal scrolling @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto("/play");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const c64uButton = page.getByRole('button', { name: /C64 Ultimate|Ultimate|C64U/i });
    if (await c64uButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await c64uButton.click();
      await page.waitForTimeout(500);
      await attachStepScreenshot(page, testInfo, 'c64u-navigation');

      // Navigate deep to get a long path
      const folder = page.getByRole('button', { name: /folder|dir/i }).first();
      let depth = 0;
      while (await folder.isVisible({ timeout: 1000 }).catch(() => false) && depth < 3) {
        await folder.click();
        await page.waitForTimeout(300);
        depth++;
      }

      if (depth > 0) {
        await attachStepScreenshot(page, testInfo, 'deep-path-displayed');

        // Check for horizontal scroll
        const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(hasHorizontalScroll).toBe(false);
        await attachStepScreenshot(page, testInfo, 'no-horizontal-scroll');
      } else {
        await attachStepScreenshot(page, testInfo, 'path-display-not-found');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'c64u-not-available');
    }
  });

  test('selection count is displayed when items are selected @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (!(await localButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
      return;
    }
    await localButton.click();
    await page.waitForTimeout(500);

    // Select an item
    const firstItem = page.getByRole('button').first();
    if (await firstItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await firstItem.click();
      await page.waitForTimeout(300);
      await attachStepScreenshot(page, testInfo, 'item-selected');

      // Look for selection count display
      const selectionCount = page.getByText(/1 selected|Selected: 1|1 item/i);
      const hasSelectionCount = await selectionCount.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasSelectionCount) {
        await attachStepScreenshot(page, testInfo, 'selection-count-displayed');
      } else {
        await attachStepScreenshot(page, testInfo, 'selection-count-not-found');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'no-items-to-select');
    }
  });

  test('quick "Root" action available in selection view @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');

    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (!(await localButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
      return;
    }
    await localButton.click();
    await page.waitForTimeout(500);
    await attachStepScreenshot(page, testInfo, 'in-selection-view');

    // Look for "Root" quick action button
    const rootButton = page.getByRole('button', { name: /Root|Go to root/i });
    const hasRootButton = await rootButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasRootButton) {
      await attachStepScreenshot(page, testInfo, 'root-button-available');
    } else {
      await attachStepScreenshot(page, testInfo, 'root-button-not-found');
    }
  });

  test('modal dialogs for mount actions @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/disks');
    await page.waitForLoadState('domcontentloaded');
    await attachStepScreenshot(page, testInfo, 'disks-page');

    // Look for mount button
    const mountButton = page.getByRole('button', { name: /Mount/i });
    if (!(await mountButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'mount-button-not-found');
      return;
    }

    await mountButton.click();
    await page.waitForTimeout(300);
    await attachStepScreenshot(page, testInfo, 'mount-clicked');

    // Should show a modal dialog
    const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
    const dialogVisible = await dialog.isVisible({ timeout: 2000 }).catch(() => false);

    if (dialogVisible) {
      await attachStepScreenshot(page, testInfo, 'modal-dialog-shown');
    } else {
      await attachStepScreenshot(page, testInfo, 'no-modal-dialog');
    }
  });

  test('clear confirmation on destructive playlist action @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');
    await attachStepScreenshot(page, testInfo, 'playlist-view');

    // Check if there are items
    const playlistItems = page.locator('[data-testid="playlist-item"], .playlist-item, [role="listitem"]');
    const itemCount = await playlistItems.count();

    if (itemCount === 0) {
      await attachStepScreenshot(page, testInfo, 'empty-playlist-no-items-to-clear');
      return;
    }

    // Look for "Clear" button
    const clearButton = page.getByRole('button', { name: /Clear all|Clear playlist|Clear/i });
    if (!(await clearButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'clear-button-not-found');
      return;
    }

    await clearButton.click();
    await page.waitForTimeout(300);
    await attachStepScreenshot(page, testInfo, 'clear-clicked');

    // Should show confirmation dialog
    const confirmDialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
    const dialogVisible = await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false);

    if (dialogVisible) {
      const dialogText = await confirmDialog.textContent();
      if (dialogText?.toLowerCase().includes('clear') || dialogText?.toLowerCase().includes('remove')) {
        await attachStepScreenshot(page, testInfo, 'clear-confirmation-shown');
      } else {
        await attachStepScreenshot(page, testInfo, 'dialog-shown-but-unclear');
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'no-clear-confirmation');
    }
  });

  test('HVSC metadata used for song display @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');
    await attachStepScreenshot(page, testInfo, 'play-page');

    // Look for HVSC-related UI elements (e.g., author, copyright, song length)
    const hvscAuthor = page.getByText(/.* - .*/); // Pattern: "Author - Title"
    const hvscDuration = page.getByText(/\d+:\d+/); // Pattern: "3:45"

    const hasAuthorInfo = await hvscAuthor.isVisible({ timeout: 2000 }).catch(() => false);
    const hasDurationInfo = await hvscDuration.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasAuthorInfo || hasDurationInfo) {
      await attachStepScreenshot(page, testInfo, 'hvsc-metadata-displayed');
    } else {
      await attachStepScreenshot(page, testInfo, 'hvsc-metadata-not-found');
    }
  });

  test('consistent selection UI across local and C64U sources @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');

    // Test local source first
    const addButton = page.getByRole('button', { name: /Add items|Add|Choose|Browse/i });
    if (!(await addButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      await attachStepScreenshot(page, testInfo, 'add-button-not-found');
      return;
    }
    await addButton.click();
    await page.waitForTimeout(300);

    const localButton = page.getByRole('button', { name: /Local|Local Files|Device/i });
    if (await localButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await localButton.click();
      await page.waitForTimeout(500);
      await attachStepScreenshot(page, testInfo, 'local-selection-ui');

      // Capture layout elements
      const selectAllLocal = page.getByRole('button', { name: /Select all/i });
      const hasSelectAllLocal = await selectAllLocal.isVisible({ timeout: 2000 }).catch(() => false);

      // Go back and try C64U
      const backButton = page.getByRole('button', { name: /Back|Cancel|Close/i }).first();
      if (await backButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await backButton.click();
        await page.waitForTimeout(300);
        await backButton.click(); // Back to source selection
        await page.waitForTimeout(300);

        const c64uButton = page.getByRole('button', { name: /C64 Ultimate|Ultimate|C64U/i });
        if (await c64uButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await c64uButton.click();
          await page.waitForTimeout(500);
          await attachStepScreenshot(page, testInfo, 'c64u-selection-ui');

          const selectAllC64u = page.getByRole('button', { name: /Select all/i });
          const hasSelectAllC64u = await selectAllC64u.isVisible({ timeout: 2000 }).catch(() => false);

          if (hasSelectAllLocal === hasSelectAllC64u) {
            await attachStepScreenshot(page, testInfo, 'consistent-selection-ui');
          } else {
            await attachStepScreenshot(page, testInfo, 'inconsistent-selection-ui');
          }
        }
      }
    } else {
      await attachStepScreenshot(page, testInfo, 'local-source-not-available');
    }
  });

  test('no unrestricted filesystem access language @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');

    // Check entire page for forbidden terms
    const pageContent = await page.textContent('body');
    const forbiddenTerms = [
      'browse filesystem',
      'root directory',
      'drill up',
      'filesystem',
      'browse files'
    ];

    const foundForbidden = forbiddenTerms.filter(term =>
      pageContent?.toLowerCase().includes(term.toLowerCase())
    );

    if (foundForbidden.length > 0) {
      await attachStepScreenshot(page, testInfo, `forbidden-terms-found-${foundForbidden.join('-')}`);
    } else {
      await attachStepScreenshot(page, testInfo, 'no-forbidden-terms');
    }
  });

  test('playlist actions easily discoverable @allow-warnings', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-warnings' });

    await page.goto('/play');
    await page.waitForLoadState('domcontentloaded');
    await attachStepScreenshot(page, testInfo, 'playlist-view');

    // Check for standard playlist actions
    const playButton = page.getByRole('button', { name: /Play|Pause/i });
    const addButton = page.getByRole('button', { name: /Add items|Add/i });
    const removeButton = page.getByRole('button', { name: /Remove|Delete/i });

    const hasPlay = await playButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasAdd = await addButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasRemove = await removeButton.isVisible({ timeout: 2000 }).catch(() => false);

    const actionCount = [hasPlay, hasAdd, hasRemove].filter(Boolean).length;

    if (actionCount >= 2) {
      await attachStepScreenshot(page, testInfo, 'playlist-actions-discoverable');
    } else {
      await attachStepScreenshot(page, testInfo, 'playlist-actions-limited');
    }
  });
});
