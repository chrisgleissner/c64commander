/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createActionExecutor } from "@/lib/telnet/telnetActionExecutor";
import {
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

// The cursor is already at the top of the listing: HOME is sent once before the
// walk, and entering a directory starts its listing at the top.
const findEntry = (session: TelnetSessionApi, label: string) =>
  navigateToFileBrowserEntry(session, label, { maxSteps: MAX_BROWSER_STEPS, startAtTop: false });

const splitRemotePath = (path: string) => path.split("/").filter(Boolean);

const openDirectoryPath = async (session: TelnetSessionApi, path: string) => {
  await session.sendKey("HOME");
  await readScreen(session);
  const parts = splitRemotePath(path);
  for (const part of parts) {
    await findEntry(session, part);
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
  await findEntry(session, targetFile);
  await session.sendKey(menuKey);
  const screen = await waitForScreen(session, await readScreen(session), (candidate) =>
    Boolean(findTopMenu(candidate)),
  );
  await navigateToMenuItem(session, screen, LOAD_SETTINGS_LABEL);
  await session.sendKey("ENTER");
  await readScreen(session);
};

export const applyRemoteConfigFromTemp = async (session: TelnetSessionApi, menuKey: TelnetMenuKey, fileName: string) =>
  applyRemoteConfigFromPath(session, menuKey, `/Temp/${fileName}`);
