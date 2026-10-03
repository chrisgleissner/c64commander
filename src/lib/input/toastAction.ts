/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ToastActionTarget = { label: string; press: () => void };

/**
 * The action (Retry, Save a local copy, …) on the newest open notification. Notifications render
 * outside the keypad focus ring, so the Quick Menu offers this as the keypad route to it; "newest"
 * is the same notification the Back key closes.
 */
export const findNewestToastAction = (): ToastActionTarget | null => {
  if (typeof document === "undefined") return null;
  const button = document.querySelector<HTMLElement>(
    '[data-testid="app-toast"][data-state="open"] [data-testid="app-toast-action"] button',
  );
  const label = button?.textContent?.trim();
  if (!button || !label) return null;
  return { label, press: () => button.click() };
};
