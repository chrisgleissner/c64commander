/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "@/components/TabBar";

/*
 * The icons-only bar has less padding than the bar with labels. Measured in whichever mode it was showing, a
 * width on the border made the labels fit once the padding had shrunk and overflow again once it had grown back,
 * so the bar changed layout on every measurement and Playwright waited for it to hold still (#554).
 */
describe("TabBar fit decision", () => {
  const observers: Array<() => void> = [];
  const realGetComputedStyle = window.getComputedStyle;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    observers.length = 0;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 275 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 34 });
    window.getComputedStyle = ((element: Element) => {
      const nav = element.tagName === "NAV";
      const padding = nav ? (element.classList.contains("tab-bar-icons") ? "4px" : "8px") : "5px";
      return { paddingLeft: padding, paddingRight: padding, minWidth: "44px" } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
  });

  afterEach(() => {
    window.getComputedStyle = realGetComputedStyle;
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it("keeps showing icons only on a bar whose labels overflow with their padding but fit with the icons-only padding", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TabBar />
      </MemoryRouter>,
    );
    const nav = document.querySelector("nav.tab-bar") as HTMLElement;
    expect(nav.classList.contains("tab-bar-icons")).toBe(true);

    for (let measurement = 0; measurement < 6; measurement += 1) {
      act(() => observers.forEach((callback) => callback()));
      expect(nav.classList.contains("tab-bar-icons")).toBe(true);
    }
  });
});
