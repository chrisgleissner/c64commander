/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useSyncExternalStore } from "react";

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

/** How long a request waits for the Config page to mount its subscriber. */
export const CONFIG_ITEM_FOCUS_LATCH_TTL_MS = 5_000;

/*
 * Latched as well as dispatched, for the same reason the section request is: activating a config
 * result from any other page navigates first, and React Router commits that asynchronously, so the
 * Config page had not subscribed when the event went out. The request was lost, the category stayed
 * shut, and the resolver reported "Could not reach" for an item that was there all along.
 */
let pendingFocus: { request: ConfigItemFocusRequest; atMs: number } | null = null;

/*
 * The item the last request was for. A config card builds its rows over several tasks, and the row a
 * search result lands on must not wait its turn: the resolver gives up after a bounded wait.
 */
let demandedItem: ConfigItemFocusRequest | null = null;
const demandSubscribers = new Set<() => void>();
const subscribeDemand = (onChange: () => void) => {
  demandSubscribers.add(onChange);
  return () => {
    demandSubscribers.delete(onChange);
  };
};

/** The item of `category` a deep link is landing on, which its list renders at once; null for none. */
export const useDemandedConfigItem = (category: string | null | undefined): string | null =>
  useSyncExternalStore(subscribeDemand, () =>
    category && demandedItem?.category === category ? demandedItem.itemName : null,
  );

export const requestConfigItemFocus = (category: string, itemName: string): void => {
  demandedItem = { category, itemName };
  for (const onChange of demandSubscribers) onChange();
  pendingFocus = { request: { category, itemName }, atMs: Date.now() };
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ConfigItemFocusRequest>(CONFIG_ITEM_FOCUS_EVENT, { detail: { category, itemName } }),
  );
};

export const subscribeConfigItemFocus = (handler: (request: ConfigItemFocusRequest) => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ConfigItemFocusRequest>).detail;
    if (!detail) return;
    // Delivering the event also claims the latch, for the reason given on the section-open latch in
    // `collapsibleSectionStore.ts`: a request that reached a mounted subscriber must not still be
    // waiting to reach the next one.
    if (pendingFocus?.request.category === detail.category && pendingFocus.request.itemName === detail.itemName) {
      pendingFocus = null;
    }
    handler(detail);
  };
  window.addEventListener(CONFIG_ITEM_FOCUS_EVENT, listener);
  // Claimed, not merely read: leaving it in place re-delivered it on every remount inside the
  // window, moving focus again on a page the user had since scrolled somewhere else.
  if (pendingFocus !== null && Date.now() - pendingFocus.atMs <= CONFIG_ITEM_FOCUS_LATCH_TTL_MS) {
    const claimed = pendingFocus;
    pendingFocus = null;
    handler(claimed.request);
  }
  return () => window.removeEventListener(CONFIG_ITEM_FOCUS_EVENT, listener);
};

/** Test seam: drops a latched request without delivering it. */
export const resetConfigItemFocusLatchForTests = (): void => {
  pendingFocus = null;
  demandedItem = null;
};
