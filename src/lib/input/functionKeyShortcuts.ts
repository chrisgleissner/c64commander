/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

import type { RemoteFunctionAction } from "@/lib/config/appSettings";
import { createTransportShortcut, type TransportShortcutOptions } from "@/lib/input/transportShortcuts";

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
