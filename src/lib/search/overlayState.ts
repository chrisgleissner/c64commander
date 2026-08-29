/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Opening the search overlay from anywhere. One implementation, three doors (spec.md D3): the field
 * at the top of Home, the top entry of the Quick Menu, and the physical key `7`. None of them owns
 * the overlay, so all three raise a request the overlay itself answers.
 */

const SEARCH_OPEN_EVENT = "c64u-search-open-request";
const SEARCH_CLOSE_EVENT = "c64u-search-close-request";

export type SearchOpenSource = "home-field" | "quick-menu" | "key" | "tour";

export interface SearchOpenRequest {
  readonly source: SearchOpenSource;
  /** Seeds the field, e.g. from the tour. Typing replaces it. */
  readonly initialQuery?: string;
}

export const requestSearchOpen = (request: SearchOpenRequest): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SearchOpenRequest>(SEARCH_OPEN_EVENT, { detail: request }));
};

export const subscribeSearchOpen = (handler: (request: SearchOpenRequest) => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => handler((event as CustomEvent<SearchOpenRequest>).detail ?? { source: "key" });
  window.addEventListener(SEARCH_OPEN_EVENT, listener);
  return () => window.removeEventListener(SEARCH_OPEN_EVENT, listener);
};

export const requestSearchClose = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SEARCH_CLOSE_EVENT));
};

export const subscribeSearchClose = (handler: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SEARCH_CLOSE_EVENT, handler);
  return () => window.removeEventListener(SEARCH_CLOSE_EVENT, handler);
};

/**
 * Whether the overlay is on screen, for anything that must not reorder under it — Home's offline
 * arrangement, for one (spec.md section 7.3). A DOM query rather than a store: the overlay is a
 * single mounted element and this cannot then disagree with what is drawn.
 */
export const SEARCH_OVERLAY_TESTID = "search-overlay";

export const isSearchOverlayOpen = (): boolean =>
  typeof document !== "undefined" && document.querySelector(`[data-testid="${SEARCH_OVERLAY_TESTID}"]`) !== null;
