/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Landing on one live config item.
 *
 * The Config page's own search box filters menu-page labels, group labels and category names — not
 * items — so global search cannot reuse it (spec.md section 5.9). What it needs instead is a deep
 * link. Which card holds a category is the page's business, not the caller's: in menu-hierarchy
 * mode a card is a menu page that may read several categories, and in REST mode it is the category
 * itself. So this only names what to reach; ConfigBrowserPage resolves the card and opens it.
 */

const CONFIG_ITEM_FOCUS_EVENT = "c64u-config-item-focus-request";

export interface ConfigItemFocusRequest {
  readonly category: string;
  readonly itemName: string;
}

/** The section id a REST-grouped category renders under. */
export const configCategorySectionId = (category: string): string => category.toLowerCase().replace(/\s+/g, "-");

export const requestConfigItemFocus = (category: string, itemName: string): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ConfigItemFocusRequest>(CONFIG_ITEM_FOCUS_EVENT, { detail: { category, itemName } }),
  );
};

export const subscribeConfigItemFocus = (handler: (request: ConfigItemFocusRequest) => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ConfigItemFocusRequest>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(CONFIG_ITEM_FOCUS_EVENT, listener);
  return () => window.removeEventListener(CONFIG_ITEM_FOCUS_EVENT, listener);
};
