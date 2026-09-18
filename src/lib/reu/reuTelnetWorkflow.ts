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
import type { ReuRestoreMode } from "./reuSnapshotTypes";

const MAX_BROWSER_STEPS = 48;

const REU_RESTORE_ACTION_LABELS: Record<ReuRestoreMode, string> = {
  "load-into-reu": "Load into REU",
  "preload-on-startup": "Preload on Startup",
};

// Each walk starts from the top of the current listing.
const findEntry = (session: TelnetSessionApi, label: string) =>
  navigateToFileBrowserEntry(session, label, { maxSteps: MAX_BROWSER_STEPS, startAtTop: true });

export const saveRemoteReuFromTemp = async (
  session: TelnetSessionApi,
  menuKey: TelnetMenuKey,
  resolvedTarget?: TelnetResolvedActionTarget,
) => {
  await findEntry(session, "Temp");
  await enterDirectoryUnderCursor(session);

  const executor = createActionExecutor(session, {
    menuKey,
    resolvedTargets: resolvedTarget ? { saveReuMemory: resolvedTarget } : undefined,
  });
  await executor.execute("saveReuMemory");
};

// HARD18-014: folderName is the persistent storage root the file was
// actually uploaded to for "preload-on-startup" (never "Temp" - see
// resolvePersistentReuStorageRoot); "load-into-reu" keeps navigating to
// "Temp" as before.
/**
 * ENTER on the file, not the menu key: the entry's own context menu is where "Load into REU" and
 * "Preload on Startup" live. Measured against a C64 Ultimate on 1.2RC, where ENTER on a `.reu`
 * answered with exactly those two labels followed by View Hex, View, Copy to..., Move to..., Rename
 * and Delete, and the menu key answered with the device's main menu instead.
 *
 * The load reports itself with a popup — "Bytes loaded: 1024 ($00000400)" with an Ok button — and
 * the session sits on it until it is dismissed, which is the second ENTER.
 */
export const restoreRemoteReu = async (
  session: TelnetSessionApi,
  fileName: string,
  mode: ReuRestoreMode,
  folderName: string,
) => {
  await findEntry(session, folderName);
  await enterDirectoryUnderCursor(session);
  await findEntry(session, fileName);
  await session.sendKey("ENTER");
  const screen = await waitForScreen(
    session,
    await readScreen(session),
    (candidate) => Boolean(findMenuOffering(candidate, REU_RESTORE_ACTION_LABELS[mode])),
    (candidate) => Boolean(findTopMenu(candidate)),
  );
  await navigateToMenuItem(session, screen, REU_RESTORE_ACTION_LABELS[mode]);
  await session.sendKey("ENTER");
  await readScreen(session);
  await session.sendKey("ENTER");
  await readScreen(session);
};
