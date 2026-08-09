/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 */

export const subscribeVicPalettePreference = (listener: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("c64u-app-settings-updated", listener);
  return () => window.removeEventListener("c64u-app-settings-updated", listener);
};
