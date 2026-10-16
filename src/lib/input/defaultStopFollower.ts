/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { FocusController } from "./focusController";

/** How long after a tab jump the page may still restore its scroll position or mount its content. */
export const FOLLOW_DEFAULT_STOP_MS = 3000;

/**
 * Keeps the stop a tab jump selected in view while the new page settles. The jump selects the page's
 * first own stop, but a kept page reappears where it was left and a page that mounts late lays out
 * after the scan that selected it: on the keypad handset the stop was off screen after 12 of 18 jumps,
 * 1293 px above the view on Play. Each scan while the ring still stands on that default stop reveals
 * it again; the first move the user makes, or the end of the window, ends it.
 */
export class DefaultStopFollower {
  private until = Number.NEGATIVE_INFINITY;

  arm(now: number = performance.now()): void {
    this.until = now + FOLLOW_DEFAULT_STOP_MS;
  }

  afterScan(
    focus: FocusController,
    elementForId: (id: string) => HTMLElement | null,
    reveal: (element: HTMLElement) => void,
    now: number = performance.now(),
  ): void {
    if (now > this.until) return;
    if (!focus.currentIsDefaultSelection()) {
      this.until = Number.NEGATIVE_INFINITY;
      return;
    }
    const id = focus.current()?.id;
    const element = id ? elementForId(id) : null;
    if (element) reveal(element);
  }
}
