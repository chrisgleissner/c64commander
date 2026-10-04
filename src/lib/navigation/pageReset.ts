/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const PAGE_RESET_EVENT = "c64u-page-reset-request";

/** Ask the page at `tabIndex` to open fresh, as a tab tapped while already selected does. */
export const requestPageReset = (tabIndex: number): void => {
  window.dispatchEvent(new CustomEvent<number>(PAGE_RESET_EVENT, { detail: tabIndex }));
};

export const subscribePageReset = (listener: (tabIndex: number) => void): (() => void) => {
  const handle = (event: Event) => listener((event as CustomEvent<number>).detail);
  window.addEventListener(PAGE_RESET_EVENT, handle);
  return () => window.removeEventListener(PAGE_RESET_EVENT, handle);
};
