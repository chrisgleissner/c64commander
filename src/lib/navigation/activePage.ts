/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Visited pages stay in the document while another tab is shown, so a page's test ids, headers and anchors exist once
 * per kept page. These lookups answer for the page on screen, and for anything outside the tab slots such as dialogs.
 */
const OFF_SCREEN_SLOT_SELECTOR = '[data-slot-active="false"]';

export const ACTIVE_SLOT_SELECTOR = '[data-slot-active="true"]';

export const isOnActivePage = (element: Element): boolean => element.closest(OFF_SCREEN_SLOT_SELECTOR) === null;

export const queryAllOnActivePage = <T extends Element = HTMLElement>(selector: string): T[] =>
  Array.from(document.querySelectorAll<T>(selector)).filter(isOnActivePage);

export const queryOnActivePage = <T extends Element = HTMLElement>(selector: string): T | null =>
  Array.from(document.querySelectorAll<T>(selector)).find(isOnActivePage) ?? null;

/** The element that holds the page's `--app-bar-height`: its tab slot, or the document root outside the tab layer. */
export const activePageStyleRoot = (): HTMLElement =>
  document.querySelector<HTMLElement>(ACTIVE_SLOT_SELECTOR) ?? document.documentElement;
