/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { buildLocalStorageKey } from "@/generated/variant";

type DevModeEventDetail = { enabled: boolean };

const DEV_MODE_KEY = buildLocalStorageKey("dev_mode_enabled");
const DEV_MODE_EVENT = "c64u-dev-mode-change";

export const getDeveloperModeEnabled = () => {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(DEV_MODE_KEY) === "1";
};

export const setDeveloperModeEnabled = (enabled: boolean) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEV_MODE_KEY, enabled ? "1" : "0");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DevModeEventDetail>(DEV_MODE_EVENT, {
        detail: { enabled },
      }),
    );
  }
};

export const subscribeDeveloperMode = (listener: (detail: DevModeEventDetail) => void) => {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<DevModeEventDetail>).detail);
  };
  window.addEventListener(DEV_MODE_EVENT, handler as EventListener);
  return () => window.removeEventListener(DEV_MODE_EVENT, handler as EventListener);
};
