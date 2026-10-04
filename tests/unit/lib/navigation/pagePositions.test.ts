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
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("invalidates remembered heights after viewport or text size changes", () => {
    const { slot } = buildSlot(0);
    rememberPagePosition(0, slot);
    expect(rememberedCardHeight("home", "video")).toBe(420);
    const original = document.documentElement.dataset.textScale;
    document.documentElement.dataset.textScale = "larger";
    expect(rememberedCardHeight("home", "video")).toBeUndefined();
    if (original === undefined) delete document.documentElement.dataset.textScale;
    else document.documentElement.dataset.textScale = original;
    vi.stubGlobal("innerWidth", window.innerWidth + 200);
    expect(rememberedCardHeight("home", "video")).toBeUndefined();
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

  it("stops holding the top card once something else scrolls the page while its content stands still", async () => {
    const { slot, scroller } = buildSlot(6);
    const [video, audio] = slot.querySelectorAll<HTMLElement>("section");
    let height = 4000;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
    const tops = new Map<Element, number>([
      [scroller, 0],
      [video, -500],
      [audio, -20],
    ]);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = tops.get(this) ?? 0;
      return { top, bottom: top + (this === video ? 420 : 300) } as DOMRect;
    });
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    scroller.scrollTop = 900;
    rememberPagePosition(6, slot);
    scroller.scrollTop = 0;
    restorePagePosition(6, slot);
    expect(scroller.scrollTop).toBe(900);

    // A card above grows: the content gets taller and the top card drifts, so it is put back.
    height = 4100;
    tops.set(audio, 80);
    await nextFrame();
    expect(scroller.scrollTop).toBe(1000);

    // The tour scrolls the page somewhere else without the content changing: the hold lets go.
    tops.set(audio, 700);
    scroller.scrollTop = 2500;
    await nextFrame();
    await nextFrame();
    expect(scroller.scrollTop).toBe(2500);
    vi.restoreAllMocks();
  });

  it("opens at the remembered offset when the card that was at the top is gone", () => {
    const { slot, scroller } = buildSlot(8);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 300 } as DOMRect);
    scroller.scrollTop = 700;
    rememberPagePosition(8, slot);
    slot.querySelectorAll("section").forEach((card) => card.remove());

    scroller.scrollTop = 0;
    restorePagePosition(8, slot);
    expect(scroller.scrollTop).toBe(700);
    vi.restoreAllMocks();
  });

  describe("holding the top card after a restore", () => {
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const reopenWithDrift = () => {
      const { slot, scroller } = buildSlot(7);
      const [video, audio] = slot.querySelectorAll<HTMLElement>("section");
      let height = 4000;
      Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
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
      rememberPagePosition(7, slot);
      scroller.scrollTop = 0;
      restorePagePosition(7, slot);
      const growAbove = () => {
        height += 100;
        tops.set(audio, (tops.get(audio) ?? 0) + 100);
      };
      return { slot, scroller, growAbove };
    };
    afterEach(() => vi.restoreAllMocks());

    it("reads settled page geometry only on resize and still corrects drift and releases on external scrolling", async () => {
      let resized: () => void = () => undefined;
      const disconnected = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resized = callback;
          }
          observe() {}
          disconnect() {
            disconnected();
          }
        },
      );
      const { scroller, growAbove } = reopenWithDrift();
      await nextFrame();
      const reads = vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;
      await nextFrame();
      await nextFrame();
      expect(vi.mocked(Element.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
      growAbove();
      resized();
      resized();
      await nextFrame();
      expect(scroller.scrollTop).toBe(1000);
      scroller.scrollTop = 2500;
      scroller.dispatchEvent(new Event("scroll"));
      expect(disconnected).toHaveBeenCalledOnce();
      growAbove();
      resized();
      await nextFrame();
      expect(scroller.scrollTop).toBe(2500);
    });

    it("disconnects resize tracking after the settling window even when the page never resizes", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const disconnected = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {
            disconnected();
          }
        },
      );
      reopenWithDrift();
      await nextFrame();
      vi.advanceTimersByTime(3000);
      expect(disconnected).toHaveBeenCalledOnce();
    });

    it("lets go after three seconds", async () => {
      const { scroller, growAbove } = reopenWithDrift();
      const now = performance.now();
      vi.spyOn(performance, "now").mockReturnValue(now + 3001);
      await nextFrame();
      const settled = scroller.scrollTop;

      growAbove();
      await nextFrame();
      expect(scroller.scrollTop).toBe(settled);
    });

    it("lets go as soon as the user touches the page", async () => {
      const { scroller, growAbove } = reopenWithDrift();
      scroller.dispatchEvent(new Event("pointerdown"));

      growAbove();
      await nextFrame();
      expect(scroller.scrollTop).toBe(900);
    });

    it("lets go when the page leaves the screen", async () => {
      const { slot, scroller, growAbove } = reopenWithDrift();
      slot.remove();

      growAbove();
      await nextFrame();
      expect(scroller.scrollTop).toBe(900);
    });
  });

  it("ignores a slot without a scroll container", () => {
    const slot = document.createElement("div");
    rememberPagePosition(4, slot);
    rememberPagePosition(4, null);
    restorePagePosition(4, null);
    expect(rememberedCardHeight("home", "video")).toBeUndefined();
  });
});
