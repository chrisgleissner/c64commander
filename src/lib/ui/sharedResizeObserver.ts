/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type SizeListener = (entry: ResizeObserverEntry) => void;

const listenersByElement = new Map<Element, Set<SizeListener>>();
let sharedObserver: ResizeObserver | null = null;

/**
 * One ResizeObserver for every component that sizes itself per row. Each observer's callback is
 * followed by a microtask checkpoint, so with one observer per row React committed after every row
 * and the next row's measurement forced a fresh layout: opening Settings created 278 of them. One
 * observer hands every changed element to its listeners in a single callback, so all of them measure
 * against the same layout and React commits once.
 *
 * Returns the function that stops listening. Without ResizeObserver it does nothing.
 */
export const observeElementSize = (element: Element, listener: SizeListener): (() => void) => {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  sharedObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      listenersByElement.get(entry.target)?.forEach((notify) => notify(entry));
    }
  });
  let listeners = listenersByElement.get(element);
  if (!listeners) {
    listeners = new Set();
    listenersByElement.set(element, listeners);
    sharedObserver.observe(element);
  }
  listeners.add(listener);
  return () => {
    const current = listenersByElement.get(element);
    if (!current?.delete(listener) || current.size > 0) return;
    listenersByElement.delete(element);
    sharedObserver?.unobserve(element);
  };
};
