/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";
import { variant } from "@/generated/variant";
import { addLog } from "@/lib/logging";

export type StartupMode = "default" | "demo" | "sid-player";
export type AppMode = "full" | "sid-player";

const STARTUP_MODE_STORAGE_KEY = "c64u_startup_mode";
const STARTUP_MODES: readonly StartupMode[] = ["default", "demo", "sid-player"];

const isStartupMode = (value: unknown): value is StartupMode => STARTUP_MODES.includes(value as StartupMode);

const readUserChoice = (): StartupMode | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const stored = localStorage.getItem(STARTUP_MODE_STORAGE_KEY);
    if (stored === null) return null;
    if (isStartupMode(stored)) return stored;
    addLog("warn", "Ignoring an unknown stored start-up mode", { key: STARTUP_MODE_STORAGE_KEY, stored });
  } catch (error) {
    addLog("warn", "Failed to read the stored start-up mode", {
      key: STARTUP_MODE_STORAGE_KEY,
      error: (error as Error).message,
    });
  }
  return null;
};

const listeners = new Set<() => void>();
let userChoice: StartupMode | null = readUserChoice();

export const loadStartupMode = (): StartupMode => userChoice ?? variant.runtime.startupMode;

const toAppMode = (mode: StartupMode): AppMode => (mode === "sid-player" ? "sid-player" : "full");

export const getAppMode = (): AppMode => toAppMode(loadStartupMode());

export const isSidPlayerActive = (): boolean => getAppMode() === "sid-player";

export const subscribeAppMode = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const saveStartupModeByUser = (mode: StartupMode): void => {
  const previous = loadStartupMode();
  userChoice = mode;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STARTUP_MODE_STORAGE_KEY, mode);
    } catch (error) {
      addLog("warn", "Failed to persist the start-up mode", {
        key: STARTUP_MODE_STORAGE_KEY,
        mode,
        error: (error as Error).message,
      });
    }
  }
  if (previous === mode) return;
  window.dispatchEvent(
    new CustomEvent("c64u-app-settings-updated", { detail: { key: STARTUP_MODE_STORAGE_KEY, value: mode } }),
  );
  for (const listener of [...listeners]) listener();
};

export const useAppMode = (): AppMode => useSyncExternalStore(subscribeAppMode, getAppMode, getAppMode);
