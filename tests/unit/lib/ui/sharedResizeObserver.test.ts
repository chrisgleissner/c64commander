/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

type Callback = (entries: Array<{ target: Element }>) => void;

const fakeObservers: Array<{ callback: Callback; observed: Set<Element> }> = [];

class FakeResizeObserver {
  observed = new Set<Element>();
  constructor(public callback: Callback) {
    fakeObservers.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
}

const loadModule = async () => {
  vi.resetModules();
  fakeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return import("@/lib/ui/sharedResizeObserver");
};

afterEach(() => vi.unstubAllGlobals());

describe("observeElementSize", () => {
  it("uses one observer for every element and hands each changed element to its own listeners", async () => {
    const { observeElementSize } = await loadModule();
    const rows = Array.from({ length: 5 }, () => document.createElement("div"));
    const seen: Element[] = [];
    rows.forEach((row) => observeElementSize(row, (entry) => seen.push(entry.target)));

    expect(fakeObservers).toHaveLength(1);
    fakeObservers[0].callback([{ target: rows[1] }, { target: rows[3] }]);

    expect(seen).toEqual([rows[1], rows[3]]);
  });

  it("stops observing an element only when its last listener stops", async () => {
    const { observeElementSize } = await loadModule();
    const row = document.createElement("div");
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = observeElementSize(row, first);
    const stopSecond = observeElementSize(row, second);

    stopFirst();
    expect(fakeObservers[0].observed.has(row)).toBe(true);
    fakeObservers[0].callback([{ target: row }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    stopSecond();
    expect(fakeObservers[0].observed.has(row)).toBe(false);
    stopSecond();
  });

  it("does nothing where ResizeObserver does not exist", async () => {
    vi.resetModules();
    vi.stubGlobal("ResizeObserver", undefined);
    const { observeElementSize } = await import("@/lib/ui/sharedResizeObserver");
    const stop = observeElementSize(document.createElement("div"), vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
