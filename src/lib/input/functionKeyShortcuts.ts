/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import { toast } from "@/hooks/use-toast";
import type { RemoteFunctionAction } from "@/lib/config/appSettings";
import { transportCommandBus, type TransportCommand } from "@/lib/input/latchedCommandBus";
import { requestQuickMenuOpen } from "@/lib/input/keypadCommands";
import { createTransportShortcut, TRANSPORT_PATH, type TransportShortcutOptions } from "@/lib/input/transportShortcuts";
import { requestSearchOpen } from "@/lib/search/overlayState";

export const REMOTE_FUNCTION_ACTION_LABELS: Readonly<Record<RemoteFunctionAction, string>> = {
  unassigned: "Unassigned",
  search: "Search",
  quickMenu: "Quick menu",
  gameMode: "Game Mode",
  playPause: "Play/Pause",
  nextTune: "Next tune",
};

/** The app-owned operations which a normal-navigation F1/F3 assignment may run. */
export type FunctionShortcutHandlers = Record<Exclude<RemoteFunctionAction, "unassigned">, () => void>;

/**
 * Execute exactly one configured function-key action. C64 surfaces, dialogs,
 * capture, text entry and View never call this: their higher-priority owners
 * consume the neutral function action first.
 */
export const runFunctionShortcut = (action: RemoteFunctionAction, handlers: FunctionShortcutHandlers): boolean => {
  if (action === "unassigned") return true;
  handlers[action]();
  return true;
};

export interface NormalNavigationFunctionShortcutOptions {
  variantId: string;
  loadAssignment: (key: 1 | 3) => RemoteFunctionAction;
  remoteHandlers: FunctionShortcutHandlers;
  transportOptions: TransportShortcutOptions;
}

/**
 * Keep the compact-handset's configurable F1/F3 contract out of the standard
 * C64 Commander variant, whose keyboard transport behavior remains unchanged.
 */
export const createNormalNavigationFunctionShortcut = ({
  variantId,
  loadAssignment,
  remoteHandlers,
  transportOptions,
}: NormalNavigationFunctionShortcutOptions): ((key: 1 | 3) => void) => {
  if (variantId === "c64u-remote") return (key) => void runFunctionShortcut(loadAssignment(key), remoteHandlers);
  return (key) => createTransportShortcut(key === 1 ? "playPause" : "next", transportOptions)();
};

export interface RemoteFunctionHandlerOptions {
  remoteInputEnabled: boolean;
  launchGameMode: () => void;
  currentPath: () => string;
}

const explainUnavailable = (action: RemoteFunctionAction, reason: string) =>
  toast({ title: `${REMOTE_FUNCTION_ACTION_LABELS[action]} is not available`, description: reason });

/**
 * The playback controller lives on the Play page, which is not mounted on other tabs. A command
 * latched while nothing consumes it would do nothing now and then fire on a later visit to Play,
 * so a press with no consumer stays put and says why instead.
 */
const publishTransport = (action: RemoteFunctionAction, command: TransportCommand, currentPath: () => string) => {
  if (!transportCommandBus.hasSubscribers() && currentPath() !== TRANSPORT_PATH) {
    explainUnavailable(action, "Playback is controlled from the Play page. Open Play, then press the key again.");
    return;
  }
  transportCommandBus.publish(command);
};

export const createRemoteFunctionHandlers = ({
  remoteInputEnabled,
  launchGameMode,
  currentPath,
}: RemoteFunctionHandlerOptions): FunctionShortcutHandlers => ({
  search: () => requestSearchOpen({ source: "key" }),
  quickMenu: () => requestQuickMenuOpen(),
  gameMode: () => {
    if (!remoteInputEnabled) {
      explainUnavailable("gameMode", "Remote Input is turned off. Turn it on in Settings to use Game Mode.");
      return;
    }
    launchGameMode();
  },
  playPause: () => publishTransport("playPause", "playPause", currentPath),
  nextTune: () => publishTransport("nextTune", "next", currentPath),
});
