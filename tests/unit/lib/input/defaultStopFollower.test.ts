/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultStopFollower, FOLLOW_DEFAULT_STOP_MS, firstStopInView } from "@/lib/input/defaultStopFollower";
import { FocusController } from "@/lib/input/focusController";

const area = { top: 50, bottom: 350 };

describe("firstStopInView", () => {
  it("picks the first stop seen whole between the bars, skipping one cut by the app bar", () => {
    const stops = [
      { id: "above", top: -200, bottom: -100 },
      { id: "cut", top: 20, bottom: 120 },
      { id: "whole", top: 130, bottom: 230 },
      { id: "next", top: 240, bottom: 340 },
    ];
    expect(firstStopInView(stops, area)).toBe("whole");
  });

  it("does not pick a stop that runs under the guidance bar", () => {
    expect(firstStopInView([{ id: "low", top: 300, bottom: 360 }], area)).toBeNull();
  });

  it("accepts a stop taller than the area when its top is inside it", () => {
    expect(firstStopInView([{ id: "tall", top: 60, bottom: 900 }], area)).toBe("tall");
    expect(firstStopInView([{ id: "tall", top: 40, bottom: 900 }], area)).toBeNull();
  });
});

describe("DefaultStopFollower", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** A page slot whose scroller is at `scrollTop`, with one 100 px stop per entry of `tops`. */
  const setup = (scrollTop: number, tops: number[]) => {
    document.body.innerHTML = `<div data-slot-active="true"><header></header><div data-page-scroll-container="true"></div></div>`;
    const scroller = document.querySelector<HTMLElement>('[data-page-scroll-container="true"]')!;
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: scrollTop });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400, height: 400 }) as DOMRect;
    document.querySelector("header")!.getBoundingClientRect = () => ({ top: 0, bottom: 50, height: 50 }) as DOMRect;
    const elements = new Map<string, HTMLElement>();
    tops.forEach((top, index) => {
      const element = document.createElement("button");
      element.getBoundingClientRect = () => ({ top, bottom: top + 100, height: 100 }) as DOMRect;
      scroller.appendChild(element);
      elements.set(`stop-${index}`, element);
    });
    const focus = new FocusController();
    focus.setItems(tops.map((_, index) => ({ id: `stop-${index}`, order: index, activate: vi.fn() })));
    const reveal = vi.fn();
    return { focus, elements, reveal, elementForId: (id: string) => elements.get(id) ?? null };
  };

  it("keeps a page that opens scrolled where it is and selects the first stop seen whole there", () => {
    const { focus, elements, reveal, elementForId } = setup(900, [-300, 20, 150, 260]);
    const follower = new DefaultStopFollower();
    follower.arm(0);

    follower.afterScan(focus, elementForId, reveal, 10);

    expect(focus.current()?.id).toBe("stop-2");
    expect(reveal).toHaveBeenLastCalledWith(elements.get("stop-2"));
  });

  it("selects the page's first stop and reveals it when no stop is in view", () => {
    const { focus, elements, reveal, elementForId } = setup(900, [-300, 380]);
    const follower = new DefaultStopFollower();
    follower.arm(0);

    follower.afterScan(focus, elementForId, reveal, 10);

    expect(focus.current()?.id).toBe("stop-0");
    expect(reveal).toHaveBeenLastCalledWith(elements.get("stop-0"));
  });

  it("selects the page's first stop at the top of the page", () => {
    const { focus, reveal, elementForId } = setup(0, [60, 170]);
    const follower = new DefaultStopFollower();
    follower.arm(0);
    follower.afterScan(focus, elementForId, reveal, 10);
    expect(focus.current()?.id).toBe("stop-0");
  });

  it("follows the page as it settles, and stops once the user moves", () => {
    const { focus, elements, reveal, elementForId } = setup(900, [-300, 150, 260, 300]);
    const follower = new DefaultStopFollower();
    follower.arm(0);
    follower.afterScan(focus, elementForId, reveal, 10);
    expect(focus.current()?.id).toBe("stop-1");

    elements.get("stop-1")!.getBoundingClientRect = () => ({ top: 10, bottom: 110, height: 100 }) as DOMRect;
    follower.afterScan(focus, elementForId, reveal, 20);
    expect(focus.current()?.id).toBe("stop-2");

    focus.focusNext();
    follower.afterScan(focus, elementForId, reveal, 30);
    expect(focus.current()?.id).toBe("stop-3");
  });

  it("does nothing before a tab jump arms it, or after the page has had its time to settle", () => {
    const { focus, reveal, elementForId } = setup(900, [-300, 150]);
    const follower = new DefaultStopFollower();
    follower.afterScan(focus, elementForId, reveal, 0);
    follower.arm(0);
    follower.afterScan(focus, elementForId, reveal, FOLLOW_DEFAULT_STOP_MS + 1);
    expect(reveal).not.toHaveBeenCalled();
    expect(focus.current()?.id).toBe("stop-0");
  });
});
