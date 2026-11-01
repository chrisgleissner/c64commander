/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Scrolls a row into the rendered range; returns false when this list does not hold the row. */
export type ListRowScroller = (rowId: string) => boolean;

const REVEAL_POLL_MS = 50;
const REVEAL_TIMEOUT_MS = 1_000;

const scrollers = new Set<ListRowScroller>();

export const registerListRowScroller = (scroller: ListRowScroller): (() => void) => {
  scrollers.add(scroller);
  return () => {
    scrollers.delete(scroller);
  };
};

const findMenuButton = (rowId: string): HTMLElement | null => {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]")).filter(
    (row) => row.dataset.rowId === rowId,
  );
  return rows.at(-1)?.querySelector<HTMLElement>('button[aria-label="Item actions"]') ?? null;
};

/**
 * The menu button of a list row, rendered first if it sits outside a virtualized list's rendered
 * range. Resolves null when no list renders the row within the bound.
 */
export const revealListRow = (rowId: string): Promise<HTMLElement | null> => {
  const rendered = findMenuButton(rowId);
  if (rendered) return Promise.resolve(rendered);
  if (![...scrollers].some((scroller) => scroller(rowId))) return Promise.resolve(null);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = () => {
      const button = findMenuButton(rowId);
      if (button || Date.now() - startedAt >= REVEAL_TIMEOUT_MS) {
        resolve(button);
        return;
      }
      setTimeout(poll, REVEAL_POLL_MS);
    };
    setTimeout(poll, REVEAL_POLL_MS);
  });
};
