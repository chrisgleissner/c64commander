/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TelnetSessionApi, TelnetScreen, MenuPath, NavigatorState, ParsedMenu } from "@/lib/telnet/telnetTypes";
import { TelnetError } from "@/lib/telnet/telnetTypes";
import { addLog } from "@/lib/logging";

const LOG_TAG = "TelnetMenuNavigator";

/** Maximum total time for a single navigation action (ms) */
const ACTION_TIMEOUT_MS = 10_000;

/** Per-step read timeout (ms) */
const STEP_READ_TIMEOUT_MS = 500;

/** Maximum ESCAPE presses to recover from desync */
const MAX_ESCAPE_RECOVERY = 5;

/** Maximum retries for a key that doesn't change the screen */
const MAX_KEY_RETRIES = 1;

/** Normalize a label for comparison: trim, lowercase, collapse whitespace */
function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Check if two labels match after normalization */
export function matchLabel(screenLabel: string, targetLabel: string): boolean {
  return normalizeLabel(screenLabel) === normalizeLabel(targetLabel);
}

export interface MenuNavigator {
  /**
   * Navigate the Telnet action menu to execute the action at the given path.
   * @param path [categoryLabel, actionLabel] — labels from TELNET_ACTIONS
   * @param menuKey The F-key to open the action menu ('F5' for U64, 'F1' for C64U)
   */
  navigate(path: MenuPath, menuKey?: "F5" | "F1"): Promise<void>;
}

/**
 * Creates a label-based menu navigator that drives the C64 Ultimate
 * Telnet action menu through VT100 key sequences.
 *
 * Navigation is always label-based — never coordinate or index-based.
 */
export function createMenuNavigator(session: TelnetSessionApi): MenuNavigator {
  let state: NavigatorState = "IDLE";

  async function navigate(path: MenuPath, menuKey: "F5" | "F1" = "F5"): Promise<void> {
    const [categoryLabel, actionLabel] = path;
    const startTime = Date.now();
    state = "IDLE";

    addLog("info", `${LOG_TAG}: navigating to [${categoryLabel} → ${actionLabel}]`, {
      menuKey,
    });

    const checkTimeout = () => {
      if (Date.now() - startTime > ACTION_TIMEOUT_MS) {
        throw new TelnetError(`Navigation timed out after ${ACTION_TIMEOUT_MS}ms`, "TIMEOUT", {
          path,
          elapsed: Date.now() - startTime,
        });
      }
    };

    try {
      // Step 1: Open action menu
      state = "OPENING_MENU";
      let screen = await openActionMenu(menuKey, checkTimeout);

      // Step 2: Find and scan the top-level menu
      state = "SCANNING_MENU";
      const topMenu = findTopMenu(screen);
      if (!topMenu) {
        throw new TelnetError("Action menu not detected on screen after opening", "MENU_NOT_FOUND");
      }

      // Step 3: Navigate to category
      state = "NAVIGATING_TO_CATEGORY";
      screen = await navigateToItem(topMenu, categoryLabel, screen, checkTimeout);

      // Step 4: Enter submenu
      state = "ENTERING_SUBMENU";
      await session.sendKey("RIGHT");
      screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
      checkTimeout();

      // Step 5: Scan submenu
      state = "SCANNING_SUBMENU";
      const subMenu = findSubmenu(screen);
      if (!subMenu) {
        throw new TelnetError(`Submenu not visible after entering category "${categoryLabel}"`, "MENU_NOT_FOUND", {
          categoryLabel,
        });
      }

      // Step 6: Navigate to action
      state = "NAVIGATING_TO_ACTION";
      screen = await navigateToItem(subMenu, actionLabel, screen, checkTimeout);

      // Step 7: Execute
      state = "EXECUTING";
      await session.sendKey("ENTER");
      screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
      checkTimeout();

      // Step 8: Verify — menu should close
      state = "VERIFYING";
      if (screen.menus.length > 0) {
        // Menu still visible — might be a confirmation dialog or slow close
        await session.readScreen(STEP_READ_TIMEOUT_MS);
      }

      state = "COMPLETE";
      addLog("info", `${LOG_TAG}: action completed [${categoryLabel} → ${actionLabel}]`, {
        elapsed: Date.now() - startTime,
      });
    } catch (error) {
      state = "ERROR";
      if (error instanceof TelnetError) throw error;
      throw new TelnetError(`Navigation failed: ${(error as Error).message}`, "NAVIGATION_FAILED", { path, state });
    }
  }

  /** Open the action menu with the correct F-key, with retry */
  async function openActionMenu(menuKey: "F5" | "F1", checkTimeout: () => void): Promise<TelnetScreen> {
    await session.sendKey(menuKey);
    let screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
    checkTimeout();

    if (!findTopMenu(screen)) {
      // Retry once
      addLog("warn", `${LOG_TAG}: menu not visible after ${menuKey}, retrying`);
      await session.sendKey(menuKey);
      screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
      checkTimeout();

      if (!findTopMenu(screen)) {
        throw new TelnetError(`Action menu not visible after ${menuKey} (tried twice)`, "MENU_NOT_FOUND", { menuKey });
      }
    }

    return screen;
  }

  /** Find the top-level (level 0) menu on screen */
  function findTopMenu(screen: TelnetScreen): ParsedMenu | null {
    return screen.menus.find((m) => m.level === 0) ?? null;
  }

  /** Find a submenu (level 1+) on screen */
  function findSubmenu(screen: TelnetScreen): ParsedMenu | null {
    return screen.menus.find((m) => m.level > 0) ?? null;
  }

  /** Navigate within a menu to the item matching the target label */
  async function navigateToItem(
    menu: ParsedMenu,
    targetLabel: string,
    currentScreen: TelnetScreen,
    checkTimeout: () => void,
  ): Promise<TelnetScreen> {
    // Find target index
    const targetIndex = menu.items.findIndex((item) => matchLabel(item.label, targetLabel));
    if (targetIndex < 0) {
      const available = menu.items.map((i) => i.label).join(", ");
      throw new TelnetError(`Item "${targetLabel}" not found. Available: [${available}]`, "ITEM_NOT_FOUND", {
        targetLabel,
        available: menu.items.map((i) => i.label),
      });
    }

    // Calculate direction and distance
    const currentIndex = menu.selectedIndex;
    if (currentIndex === targetIndex) {
      return currentScreen; // Already on target
    }

    const direction = targetIndex > currentIndex ? "DOWN" : "UP";
    const distance = Math.abs(targetIndex - currentIndex);

    let screen = currentScreen;
    for (let step = 0; step < distance; step++) {
      await session.sendKey(direction);
      screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
      checkTimeout();

      // Verify cursor moved
      const refreshedMenu = findMenuAtLevel(screen, menu.level);
      if (!refreshedMenu) {
        throw new TelnetError("Menu disappeared during navigation", "DESYNC", { targetLabel, step });
      }

      const expectedIndex = currentIndex + (direction === "DOWN" ? step + 1 : -(step + 1));
      if (refreshedMenu.selectedIndex !== expectedIndex) {
        // Retry the key once
        addLog("warn", `${LOG_TAG}: cursor didn't move as expected, retrying`);
        await session.sendKey(direction);
        screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
        checkTimeout();

        const retryMenu = findMenuAtLevel(screen, menu.level);
        if (!retryMenu || retryMenu.selectedIndex !== expectedIndex) {
          throw new TelnetError(
            `Cursor stuck at index ${retryMenu?.selectedIndex ?? "?"}, expected ${expectedIndex}`,
            "DESYNC",
            { targetLabel, expected: expectedIndex, actual: retryMenu?.selectedIndex },
          );
        }
      }
    }

    // Verify the final selected item matches
    const finalMenu = findMenuAtLevel(screen, menu.level);
    if (
      finalMenu &&
      finalMenu.items[finalMenu.selectedIndex] &&
      !matchLabel(finalMenu.items[finalMenu.selectedIndex].label, targetLabel)
    ) {
      throw new TelnetError(
        `Selected item "${finalMenu.items[finalMenu.selectedIndex].label}" doesn't match target "${targetLabel}"`,
        "DESYNC",
        { targetLabel, actual: finalMenu.items[finalMenu.selectedIndex].label },
      );
    }

    return screen;
  }

  /** Find a menu at a specific level */
  function findMenuAtLevel(screen: TelnetScreen, level: number): ParsedMenu | null {
    return screen.menus.find((m) => m.level === level) ?? null;
  }

  /** Attempt to recover from a desynchronized state by pressing LEFT repeatedly */
  async function _recoverFromDesync(): Promise<TelnetScreen> {
    addLog("warn", `${LOG_TAG}: attempting desync recovery using LEFT key`);
    let screen: TelnetScreen | null = null;
    for (let i = 0; i < MAX_ESCAPE_RECOVERY; i++) {
      await session.sendKey("LEFT");
      screen = await session.readScreen(STEP_READ_TIMEOUT_MS);
      if (screen.menus.length === 0) {
        addLog("info", `${LOG_TAG}: recovered to file browser after ${i + 1} LEFT presses`);
        return screen;
      }
    }
    throw new TelnetError(`Could not recover from desync after ${MAX_ESCAPE_RECOVERY} LEFT presses`, "DESYNC");
  }

  return { navigate };
}
