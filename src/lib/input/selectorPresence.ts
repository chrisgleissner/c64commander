/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether any element of a document matches a selector, kept current by a MutationObserver rather
 * than found by a document-wide search on every call. A search that finds nothing visits every
 * element: 3.5 ms per call with about 4,600 elements on a low-end keypad handset, several times
 * per key press.
 *
 * Reads are exact even straight after a DOM change in the same task, because each read first takes
 * the observer's pending records. `attributes` must list every attribute the selector tests.
 */
export interface SelectorPresence {
  readonly isPresent: () => boolean;
  /** Called after a change of {@link isPresent}, in a microtask, like a MutationObserver callback. */
  readonly subscribe: (listener: () => void) => () => void;
}

const firstMatchIn = (node: Node, selector: string): Element | null => {
  if (!(node instanceof Element) || !node.isConnected) return null;
  return node.matches(selector) ? node : node.querySelector(selector);
};

const createObservedPresence = (doc: Document, selector: string, attributes: readonly string[]): SelectorPresence => {
  let match: Element | null = null;
  let stale = true;
  let reported: boolean | null = null;
  const listeners = new Set<() => void>();

  const absorb = (records: readonly MutationRecord[]) => {
    for (const record of records) {
      if (stale || match) break;
      if (record.type === "attributes") {
        const target = record.target;
        match = target instanceof Element && target.isConnected && target.matches(selector) ? target : null;
        continue;
      }
      for (const added of record.addedNodes) {
        match = firstMatchIn(added, selector);
        if (match) break;
      }
    }
    if (match && !(match.isConnected && match.matches(selector))) stale = true;
  };

  const isPresent = (): boolean => {
    absorb(observer.takeRecords());
    if (stale) {
      match = doc.querySelector(selector);
      stale = false;
    }
    return match !== null;
  };

  const notifyIfChanged = () => {
    if (listeners.size === 0) return;
    const present = isPresent();
    if (present === reported) return;
    reported = present;
    listeners.forEach((listener) => listener());
  };

  const observer = new MutationObserver((records) => {
    absorb(records);
    notifyIfChanged();
  });
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: [...attributes] });

  return {
    isPresent: () => {
      const present = isPresent();
      if (listeners.size > 0 && present !== reported) queueMicrotask(notifyIfChanged);
      return present;
    },
    subscribe: (listener) => {
      if (listeners.size === 0) reported = isPresent();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const createQueriedPresence = (doc: Document, selector: string): SelectorPresence => ({
  isPresent: () => doc.querySelector(selector) !== null,
  subscribe: () => () => undefined,
});

const trackers = new WeakMap<Document, Map<string, SelectorPresence>>();

export const selectorPresence = (doc: Document, selector: string, attributes: readonly string[]): SelectorPresence => {
  let bySelector = trackers.get(doc);
  if (!bySelector) {
    bySelector = new Map();
    trackers.set(doc, bySelector);
  }
  let tracker = bySelector.get(selector);
  if (!tracker) {
    tracker =
      typeof MutationObserver === "undefined"
        ? createQueriedPresence(doc, selector)
        : createObservedPresence(doc, selector, attributes);
    bySelector.set(selector, tracker);
  }
  return tracker;
};
