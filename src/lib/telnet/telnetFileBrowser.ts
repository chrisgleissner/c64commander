/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { matchLabel } from "@/lib/telnet/telnetMenuNavigator";
import type { ParsedMenu, TelnetScreen, TelnetSessionApi } from "@/lib/telnet/telnetTypes";
import { TelnetError } from "@/lib/telnet/telnetTypes";

const BROWSER_STEP_TIMEOUT_MS = 500;
const MAX_SETTLE_READS = 3;
const MAX_STALLED_STEPS = 3;

export const readScreen = async (session: TelnetSessionApi) => session.readScreen(BROWSER_STEP_TIMEOUT_MS);

/**
 * Step into the directory under the cursor.
 *
 * RIGHT, not ENTER. The device's tree browser maps ENTER to opening the entry's context menu — the
 * one offering Enter, Copy to..., Move to..., Rename and Delete — and RIGHT to descending into it:
 * `handle_key` in the firmware's `tree_browser.cc` sends KEY_RETURN to `context(0)` and KEY_RIGHT
 * to `state->into2()`. Confirmed against a C64 Ultimate on 1.2RC, where RIGHT on `Temp` answered
 * with the contents of `/Temp/` and ENTER answered with that five-item menu.
 *
 * Sending ENTER left the context menu open over the listing. The next search for a path segment
 * then walked that menu's five items looking for a directory name, never found one, and ran to its
 * step limit before failing — once for every segment of the path.
 */
export const enterDirectoryUnderCursor = async (session: TelnetSessionApi) => {
  await session.sendKey("RIGHT");
  return readScreen(session);
};

/** How deep a path the climb to the root has to undo. Nothing on these devices nests this far. */
const MAX_LEVELS_UP = 8;

/** A read that drew nothing: the device had nothing to say about the key it was just sent. */
const isBlankScreen = (screen: TelnetScreen) =>
  screen.cells.every((row) => row.every((cell) => cell.char === " " || cell.char === ""));

/**
 * Take the browser back to the device root, whatever directory it is sitting in.
 *
 * LEFT is `state->level_up()` in the firmware's `tree_browser.cc`, and at the root it does nothing,
 * so pressing it a bounded number of times lands at the root from anywhere. HOME does NOT do this:
 * KEY_HOME is `cd(CFG_USERIF_HOME_DIR)` — go to the configured home directory — which is unset on
 * this rig and silently did nothing, and on a device where it is set would move the browser
 * somewhere else entirely.
 */
export const returnToBrowserRoot = async (session: TelnetSessionApi) => {
  for (let level = 0; level < MAX_LEVELS_UP; level += 1) {
    await session.sendKey("LEFT");
    // Already at the root: the firmware redraws nothing, so nothing comes back. Stopping on that
    // keeps a browser that is already there to one keypress rather than eight.
    if (isBlankScreen(await readScreen(session))) return;
  }
};

/**
 * The device redraws a step or two behind the keypress, so a read taken right
 * after one can still show the previous screen. Re-read until the caller's
 * predicate holds, then give up and return whatever the last read produced —
 * the caller decides whether that screen is usable.
 */
export const waitForScreen = async (
  session: TelnetSessionApi,
  initialScreen: TelnetScreen,
  predicate: (screen: TelnetScreen) => boolean,
  /*
   * What to hand back when the wait runs out: the last screen that satisfied this, in preference to
   * the last screen read. A caller waiting for the menu that offers a particular action wants the
   * menu it did get rather than whatever the device drew next, so the failure can name what that
   * menu offered instead.
   */
  fallbackPredicate?: (screen: TelnetScreen) => boolean,
) => {
  let screen = initialScreen;
  let fallback: TelnetScreen | null = null;
  for (let attempt = 0; attempt < MAX_SETTLE_READS; attempt += 1) {
    if (predicate(screen)) return screen;
    if (!fallback && fallbackPredicate?.(screen)) fallback = screen;
    screen = await readScreen(session);
  }
  if (predicate(screen)) return screen;
  return fallback ?? screen;
};

export const findTopMenu = (screen: TelnetScreen): ParsedMenu | null =>
  screen.menus.find((menu) => menu.level === 0) ?? screen.menus[0] ?? null;

/**
 * The menu that actually offers `label`.
 *
 * The frame a file listing is drawn in parses as a menu too, so "a menu is on screen" is not the
 * same question as "the menu that was just opened is on screen". A caller that waits for the first
 * and then reads the second gets whichever box happened to be found first.
 */
export const findMenuOffering = (screen: TelnetScreen, label: string): ParsedMenu | null =>
  screen.menus.find((menu) => menu.items.some((item) => matchLabel(item.label, label))) ?? null;

/** Move the context menu's selection onto `label` with UP/DOWN keypresses. */
export const navigateToMenuItem = async (session: TelnetSessionApi, screen: TelnetScreen, label: string) => {
  const menu = findMenuOffering(screen, label) ?? findTopMenu(screen);
  if (!menu) {
    throw new TelnetError("Context menu not visible", "MENU_NOT_FOUND");
  }
  const targetIndex = menu.items.findIndex((item) => matchLabel(item.label, label));
  if (targetIndex < 0) {
    throw new TelnetError(`Menu item not found: ${label}`, "ITEM_NOT_FOUND", {
      label,
      available: menu.items.map((item) => item.label),
    });
  }
  let currentIndex = menu.selectedIndex;
  let currentScreen = screen;
  while (currentIndex !== targetIndex) {
    await session.sendKey(targetIndex > currentIndex ? "DOWN" : "UP");
    currentScreen = await waitForScreen(session, await readScreen(session), (candidate) => {
      const refreshedMenu = findTopMenu(candidate);
      return Boolean(refreshedMenu) && refreshedMenu!.selectedIndex !== currentIndex;
    });
    const refreshedMenu = findTopMenu(currentScreen);
    if (!refreshedMenu) {
      throw new TelnetError("Context menu disappeared during navigation", "DESYNC", { label });
    }
    currentIndex = refreshedMenu.selectedIndex;
  }
  return currentScreen;
};

/**
 * Walk the file browser downwards until `label` is selected.
 *
 * The browser gives no way to ask where the cursor is, so progress is inferred
 * from the selection changing. A selection that does not move for
 * `MAX_STALLED_STEPS` presses means the walk is stuck rather than slow, and is
 * reported as a timeout instead of silently spending the whole step budget.
 *
 * `maxSteps` is per caller because the two callers walk lists of very different
 * length.
 *
 * The walk turns round at the end of the list rather than giving up there. The listing does not
 * wrap, and the cursor does not start at the top: entering a directory and coming back out of it
 * leaves the cursor on the directory it came from, so an entry above that is unreachable by DOWN
 * alone. On an Ultimate 64 that is `Temp` — third in the root listing, below the entry a returning
 * cursor sits on — and every attempt to stage a settings file through `/Temp` walked to the bottom
 * of the list and stopped.
 *
 * There is no "start at the top" any more. It used to be a HOME press, and in this firmware
 * KEY_HOME means "go to the configured home directory" (`tree_browser.cc` calls
 * `cd(CFG_USERIF_HOME_DIR)`) rather than "top of list", so it either did nothing or moved the
 * browser somewhere else entirely. Turning round at the end of the list makes it unnecessary.
 */
export const navigateToFileBrowserEntry = async (
  session: TelnetSessionApi,
  label: string,
  { maxSteps }: { maxSteps: number },
) => {
  let screen = await waitForScreen(session, await readScreen(session), (candidate) => Boolean(candidate.selectedItem));
  let currentLabel = screen.selectedItem;
  let stalledSteps = 0;
  let direction: "DOWN" | "UP" = "DOWN";
  let turnedRound = false;
  for (let step = 0; step < maxSteps;) {
    if (screen.selectedItem && matchLabel(screen.selectedItem, label)) {
      return screen;
    }
    await session.sendKey(direction);
    screen = await waitForScreen(session, await readScreen(session), (candidate) => {
      if (!candidate.selectedItem) return false;
      if (matchLabel(candidate.selectedItem, label)) return true;
      return currentLabel ? !matchLabel(candidate.selectedItem, currentLabel) : true;
    });
    if (screen.selectedItem && currentLabel && matchLabel(screen.selectedItem, currentLabel)) {
      stalledSteps += 1;
      if (stalledSteps >= MAX_STALLED_STEPS) {
        if (turnedRound) {
          throw new TelnetError(`File browser navigation stalled before finding ${label}`, "TIMEOUT", {
            label,
            current: screen.selectedItem,
          });
        }
        // The end of the list, not a stuck browser: go back the other way.
        turnedRound = true;
        direction = direction === "DOWN" ? "UP" : "DOWN";
        stalledSteps = 0;
      }
      continue;
    }
    stalledSteps = 0;
    currentLabel = screen.selectedItem;
    step += 1;
  }
  throw new TelnetError(`File browser item not found: ${label}`, "ITEM_NOT_FOUND", { label });
};
