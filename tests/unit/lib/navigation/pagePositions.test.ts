/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetPagePosition,
  rememberPagePosition,
  rememberedCardHeight,
  resetPagePositionsForTests,
  restorePagePosition,
} from "@/lib/navigation/pagePositions";

const buildSlot = (pageIndex: number) => {
  const slot = document.createElement("div");
  slot.dataset.routeIndex = String(pageIndex);
  slot.innerHTML = `
    <div data-page-scroll-container="true">
      <section data-section-scope="home" data-section-id="video" data-body-mounted="true"><p>card</p></section>
      <section data-section-scope="home" data-section-id="audio"><p>waiting card</p></section>
    </div>`;
  document.body.appendChild(slot);
  const scroller = slot.querySelector<HTMLElement>("[data-page-scroll-container]")!;
  const [mounted, waiting] = slot.querySelectorAll<HTMLElement>("section");
  Object.defineProperty(mounted, "offsetHeight", { configurable: true, value: 420 });
  Object.defineProperty(waiting, "offsetHeight", { configurable: true, value: 60 });
  return { slot, scroller };
};

describe("pagePositions", () => {
  beforeEach(() => resetPagePositionsForTests());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("puts a page back at the scroll offset it was left at", () => {
    const { slot, scroller } = buildSlot(2);
    scroller.scrollTop = 640;
    rememberPagePosition(2, slot);

    scroller.scrollTop = 0;
    restorePagePosition(2, slot);
    expect(scroller.scrollTop).toBe(640);
  });

  it("leaves a page it has no position for where it is", () => {
    const { slot, scroller } = buildSlot(1);
    scroller.scrollTop = 25;
    restorePagePosition(1, slot);
    expect(scroller.scrollTop).toBe(25);
  });

  it("remembers the height of each built card and not of a card still waiting", () => {
    const { slot } = buildSlot(0);
    rememberPagePosition(0, slot);

    expect(rememberedCardHeight("home", "video")).toBe(420);
    expect(rememberedCardHeight("home", "audio")).toBeUndefined();
  });

  it("opens a forgotten page at the top, even though the page torn down to reopen it records once more", () => {
    const { slot, scroller } = buildSlot(3);
    scroller.scrollTop = 500;
    rememberPagePosition(3, slot);
    forgetPagePosition(3);
    rememberPagePosition(3, slot);

    scroller.scrollTop = 0;
    restorePagePosition(3, slot);
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = 120;
    rememberPagePosition(3, slot);
    scroller.scrollTop = 0;
    restorePagePosition(3, slot);
    expect(scroller.scrollTop).toBe(120);
  });

  it("keeps the card that was at the top in place when the cards above it have changed height", () => {
    const { slot, scroller } = buildSlot(5);
    const [video, audio] = slot.querySelectorAll<HTMLElement>("section");
    const tops = new Map<Element, number>([
      [scroller, 0],
      [video, -500],
      [audio, -20],
    ]);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = tops.get(this) ?? 0;
      return { top, bottom: top + (this === video ? 420 : 300) } as DOMRect;
    });
    scroller.scrollTop = 900;
    rememberPagePosition(5, slot);

    // Reopened with a taller card above: the remembered top card now starts 140 px lower.
    tops.set(audio, 120);
    scroller.scrollTop = 0;
    restorePagePosition(5, slot);

    expect(scroller.scrollTop).toBe(900 + 140);
    vi.restoreAllMocks();
  });

  it("ignores a slot without a scroll container", () => {
    const slot = document.createElement("div");
    rememberPagePosition(4, slot);
    rememberPagePosition(4, null);
    restorePagePosition(4, null);
    expect(rememberedCardHeight("home", "video")).toBeUndefined();
  });
});
