/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import { matchLabel } from "@/lib/telnet/telnetMenuNavigator";
import type { ParsedMenu, TelnetMenuKey, TelnetScreen, TelnetSessionApi } from "@/lib/telnet/telnetTypes";
import { TelnetError } from "@/lib/telnet/telnetTypes";
import type { ReuRestoreMode } from "./reuSnapshotTypes";

const BROWSER_STEP_TIMEOUT_MS = 500;
const MAX_BROWSER_STEPS = 48;

const REU_RESTORE_ACTION_LABELS: Record<ReuRestoreMode, string> = {
  "load-into-reu": "Load into REU",
  "preload-on-startup": "Preload on Startup",
};

const readScreen = async (session: TelnetSessionApi) => session.readScreen(BROWSER_STEP_TIMEOUT_MS);

const findTopMenu = (screen: TelnetScreen): ParsedMenu | null => screen.menus[0] ?? null;

const navigateToMenuItem = async (session: TelnetSessionApi, screen: TelnetScreen, label: string) => {
  const menu = findTopMenu(screen);
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
    currentScreen = await readScreen(session);
    const refreshedMenu = findTopMenu(currentScreen);
    if (!refreshedMenu) {
      throw new TelnetError("Context menu disappeared during navigation", "DESYNC", { label });
    }
    currentIndex = refreshedMenu.selectedIndex;
  }
  return currentScreen;
};

const navigateToFileBrowserEntry = async (session: TelnetSessionApi, label: string) => {
  await session.sendKey("HOME");
  let screen = await readScreen(session);
  for (let step = 0; step < MAX_BROWSER_STEPS; step += 1) {
    if (screen.selectedItem && matchLabel(screen.selectedItem, label)) {
      return screen;
    }
    await session.sendKey("DOWN");
    screen = await readScreen(session);
  }
  throw new TelnetError(`File browser item not found: ${label}`, "ITEM_NOT_FOUND", { label });
};

export const saveRemoteReuFromTemp = async (session: TelnetSessionApi, menuKey: TelnetMenuKey) => {
  await navigateToFileBrowserEntry(session, "Temp");
  await session.sendKey("ENTER");
  await readScreen(session);

  const executor = createActionExecutor(session, { menuKey });
  await executor.execute("saveReuMemory");
};

export const restoreRemoteReuFromTemp = async (
  session: TelnetSessionApi,
  menuKey: TelnetMenuKey,
  fileName: string,
  mode: ReuRestoreMode,
) => {
  await navigateToFileBrowserEntry(session, "Temp");
  await session.sendKey("ENTER");
  await readScreen(session);
  await navigateToFileBrowserEntry(session, fileName);
  await session.sendKey(menuKey);
  let screen = await readScreen(session);
  screen = await navigateToMenuItem(session, screen, REU_RESTORE_ACTION_LABELS[mode]);
  await session.sendKey("ENTER");
  await readScreen(session);
};
