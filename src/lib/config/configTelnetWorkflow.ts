/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import {
  enterDirectoryUnderCursor,
  findMenuOffering,
  findTopMenu,
  navigateToFileBrowserEntry,
  navigateToMenuItem,
  readScreen,
  waitForScreen,
} from "@/lib/telnet/telnetFileBrowser";
import type { TelnetResolvedActionTarget } from "@/lib/telnet/telnetCapabilityDiscovery";
import type { TelnetMenuKey, TelnetSessionApi } from "@/lib/telnet/telnetTypes";
import { TelnetError } from "@/lib/telnet/telnetTypes";

const MAX_BROWSER_STEPS = 96;
const LOAD_SETTINGS_LABEL = "Load Settings";

// `findEntry` does not press HOME itself. Its callers have already placed the
// cursor at the top: `openDirectoryPath` sends HOME before its loop, and
// entering a directory starts that directory's listing at the top.
const findEntry = (session: TelnetSessionApi, label: string) =>
  navigateToFileBrowserEntry(session, label, { maxSteps: MAX_BROWSER_STEPS, startAtTop: false });

const splitRemotePath = (path: string) => path.split("/").filter(Boolean);

const openDirectoryPath = async (session: TelnetSessionApi, path: string) => {
  await session.sendKey("HOME");
  await readScreen(session);
  const parts = splitRemotePath(path);
  for (const part of parts) {
    await findEntry(session, part);
    await enterDirectoryUnderCursor(session);
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

export const saveRemoteConfigFromTemp = async (
  session: TelnetSessionApi,
  menuKey: TelnetMenuKey,
  resolvedTarget?: TelnetResolvedActionTarget,
) => {
  await openDirectoryPath(session, "/Temp");
  const executor = createActionExecutor(session, {
    menuKey,
    resolvedTargets: resolvedTarget ? { saveConfigToFile: resolvedTarget } : undefined,
  });
  await executor.execute("saveConfigToFile");
};

/**
 * Load a settings file the device already holds, by driving its file browser.
 *
 * ENTER on the file, not the menu key. ENTER opens the entry's own context menu, which for a `.cfg`
 * offers Load Settings, View Hex, View, Copy to..., Move to..., Rename and Delete. The menu key
 * opens the device's main menu instead — Create, Power & Reset, Configuration and the rest — which
 * has no Load Settings in it, so the walk ended looking for an item that was never going to be
 * there. Measured against a C64 Ultimate on 1.2RC, where ENTER answered with that context menu, F1
 * answered with the main menu and F5 answered with nothing at all.
 *
 * Loading reports itself with a popup — "Loading configuration successful!" with an Ok button — and
 * the session is left sitting on it unless it is dismissed, which is why this ends with a second
 * ENTER rather than a read.
 */
export const applyRemoteConfigFromPath = async (session: TelnetSessionApi, remotePath: string) => {
  const targetFile = basename(remotePath);
  if (!targetFile) {
    throw new TelnetError(`Invalid config path: ${remotePath}`, "ITEM_NOT_FOUND", { remotePath });
  }
  await openDirectoryPath(session, parentPath(remotePath));
  await findEntry(session, targetFile);
  await session.sendKey("ENTER");
  // The listing's own frame parses as a menu, so waiting for "a menu" ends before the entry's menu
  // has been drawn. What is waited for is the menu that offers what is about to be pressed.
  const screen = await waitForScreen(
    session,
    await readScreen(session),
    (candidate) => Boolean(findMenuOffering(candidate, LOAD_SETTINGS_LABEL)),
    (candidate) => Boolean(findTopMenu(candidate)),
  );
  await navigateToMenuItem(session, screen, LOAD_SETTINGS_LABEL);
  await session.sendKey("ENTER");
  await readScreen(session);
  await session.sendKey("ENTER");
  await readScreen(session);
};

export const applyRemoteConfigFromTemp = async (session: TelnetSessionApi, fileName: string) =>
  applyRemoteConfigFromPath(session, `/Temp/${fileName}`);
