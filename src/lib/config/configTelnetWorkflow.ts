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

const BROWSER_STEP_TIMEOUT_MS = 500;
const MAX_BROWSER_STEPS = 96;
const LOAD_SETTINGS_LABEL = "Load Settings";

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

const splitRemotePath = (path: string) => path.split("/").filter(Boolean);

const openDirectoryPath = async (session: TelnetSessionApi, path: string) => {
  await session.sendKey("HOME");
  await readScreen(session);
  const parts = splitRemotePath(path);
  for (const part of parts) {
    await navigateToFileBrowserEntry(session, part);
    await session.sendKey("ENTER");
    await readScreen(session);
  }
};

const parentPath = (path: string) => {
  const parts = splitRemotePath(path);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
};

const basename = (path: string) => {
  const parts = splitRemotePath(path);
  return parts[parts.length - 1] ?? "";
};

export const saveRemoteConfigFromTemp = async (session: TelnetSessionApi, menuKey: TelnetMenuKey) => {
  await openDirectoryPath(session, "/Temp");
  const executor = createActionExecutor(session, { menuKey });
  await executor.execute("saveConfigToFile");
};

export const applyRemoteConfigFromPath = async (
  session: TelnetSessionApi,
  menuKey: TelnetMenuKey,
  remotePath: string,
) => {
  const targetFile = basename(remotePath);
  if (!targetFile) {
    throw new TelnetError(`Invalid config path: ${remotePath}`, "ITEM_NOT_FOUND", { remotePath });
  }
  await openDirectoryPath(session, parentPath(remotePath));
  await navigateToFileBrowserEntry(session, targetFile);
  await session.sendKey(menuKey);
  let screen = await readScreen(session);
  screen = await navigateToMenuItem(session, screen, LOAD_SETTINGS_LABEL);
  await session.sendKey("ENTER");
  await readScreen(session);
};

export const applyRemoteConfigFromTemp = async (session: TelnetSessionApi, menuKey: TelnetMenuKey, fileName: string) =>
  applyRemoteConfigFromPath(session, menuKey, `/Temp/${fileName}`);
