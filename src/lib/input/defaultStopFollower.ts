/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FocusController, FocusItem } from "./focusController";
import { TABBAR_SCOPE_SELECTOR } from "./discovery";

/** How long after a tab jump the page may still restore its scroll position or mount its content. */
export const FOLLOW_DEFAULT_STOP_MS = 3000;

export type StopBox = { readonly id: string; readonly top: number; readonly bottom: number };
export type ViewArea = { readonly top: number; readonly bottom: number };

/**
 * The first stop the reader can see whole between the app bar and the guidance bar. A stop taller than
 * that area counts when its top edge is inside it, because it can never be seen whole.
 */
export const firstStopInView = (stops: readonly StopBox[], area: ViewArea): string | null => {
  const height = area.bottom - area.top;
  const inView = (stop: StopBox) =>
    stop.top >= area.top - 0.5 &&
    (stop.bottom <= area.bottom + 0.5 || (stop.bottom - stop.top > height && stop.top < area.bottom));
  return stops.find(inView)?.id ?? null;
};

const ACTIVE_SLOT = '[data-slot-active="true"]';
const PAGE_SCROLLER = '[data-page-scroll-container="true"]';

/** The part of the page scroller left visible by the app bar above and the guidance and tab bars below. */
const visibleArea = (scroller: HTMLElement): ViewArea => {
  const box = scroller.getBoundingClientRect();
  let top = box.top;
  let bottom = box.bottom;
  const header = scroller.closest(ACTIVE_SLOT)?.querySelector("header");
  if (header) top = Math.max(top, header.getBoundingClientRect().bottom);
  for (const bar of document.querySelectorAll('[data-testid="keypad-guidance-bar"], ' + TABBAR_SCOPE_SELECTOR)) {
    if (!(bar instanceof HTMLElement) || bar.getAttribute("data-visible") === "false") continue;
    const barBox = bar.getBoundingClientRect();
    if (barBox.height > 0 && barBox.top > top) bottom = Math.min(bottom, barBox.top);
  }
  return { top, bottom };
};

/** The page's own top-level stops, in ring order, with their boxes; null when the page has no scroller. */
const pageStops = (
  items: readonly FocusItem[],
  elementForId: (id: string) => HTMLElement | null,
): { scroller: HTMLElement; stops: StopBox[] } | null => {
  let scroller: HTMLElement | null = null;
  const stops: StopBox[] = [];
  for (const item of items) {
    if (item.parentId !== undefined || item.chrome || item.disabled) continue;
    const element = elementForId(item.id);
    const host = element?.closest<HTMLElement>(PAGE_SCROLLER);
    if (!element || !host || !host.closest(ACTIVE_SLOT)) continue;
    scroller ??= host;
    const box = element.getBoundingClientRect();
    stops.push({ id: item.id, top: box.top, bottom: box.bottom });
  }
  return scroller ? { scroller, stops } : null;
};

/**
 * Chooses the stop a tab jump lands on and keeps it on screen while the new page settles. A page opens
 * where it was left, so the ring selects the first stop the reader can see there, clear of the app bar
 * and the guidance bar. At the top of the page, or when no stop is in view, it selects the page's first
 * stop and brings it into view. Before this, the first stop was selected wherever it was: on the keypad
 * handset it was off screen after 12 of 18 jumps, 1293 px above the view on Play.
 *
 * It runs after each scan for a few seconds, because the page restores its position and mounts its
 * content after the scan that first sees it. The first move the user makes ends it.
 */
export class DefaultStopFollower {
  private until = Number.NEGATIVE_INFINITY;
  private chosen: string | null = null;

  arm(now: number = performance.now()): void {
    this.until = now + FOLLOW_DEFAULT_STOP_MS;
    this.chosen = null;
  }

  afterScan(
    focus: FocusController,
    elementForId: (id: string) => HTMLElement | null,
    reveal: (element: HTMLElement) => void,
    now: number = performance.now(),
  ): void {
    if (now > this.until) return;
    const current = focus.current()?.id ?? null;
    const userMoved = !focus.currentIsDefaultSelection() && current !== this.chosen;
    if (userMoved) {
      this.until = Number.NEGATIVE_INFINITY;
      return;
    }
    const page = pageStops(focus.list(), elementForId);
    const visible =
      page && page.scroller.scrollTop >= 1 ? firstStopInView(page.stops, visibleArea(page.scroller)) : null;
    if (visible) {
      if (visible !== current) focus.setCurrent(visible);
      this.chosen = visible;
      const element = elementForId(visible);
      if (element) reveal(element);
      return;
    }
    if (this.chosen !== null) {
      focus.resetToDefault();
      this.chosen = null;
    }
    const id = focus.current()?.id;
    const element = id ? elementForId(id) : null;
    if (element) reveal(element);
  }
}
