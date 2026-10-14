/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { leavesScrollContainer, scrollTowardUnreachableContent } from "@/lib/input/ringDom";

type Metrics = { scrollHeight: number; clientHeight: number; scrollTop: number; controlTop?: number };

const scrollingPage = ({ scrollHeight, clientHeight, scrollTop, controlTop = 350 }: Metrics) => {
  const page = document.createElement("div");
  page.style.overflowY = "auto";
  Object.defineProperty(page, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(page, "clientHeight", { value: clientHeight });
  page.scrollTop = scrollTop;
  page.getBoundingClientRect = () => ({ top: 0, bottom: clientHeight }) as DOMRect;
  const scrollBy = vi.fn();
  page.scrollBy = scrollBy as unknown as typeof page.scrollBy;
  const lastControl = document.createElement("button");
  lastControl.getBoundingClientRect = () => ({ top: controlTop, bottom: controlTop + 20 }) as DOMRect;
  page.append(lastControl);
  document.body.append(page);
  return { page, lastControl, scrollBy };
};

const group = (top: number, bottom: number) => {
  const element = document.createElement("section");
  element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty("--keypad-guidance-reserved-height");
});

describe("scrollTowardUnreachableContent", () => {
  it("scrolls the page down toward text below the last control, until the control reaches the top", () => {
    const { lastControl, scrollBy } = scrollingPage({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });

    expect(scrollTowardUnreachableContent(lastControl, null, 1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 350 });
  });

  it("keeps the control clear of its top scroll margin", () => {
    const { lastControl, scrollBy } = scrollingPage({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    lastControl.style.scrollMarginTop = "80px";

    expect(scrollTowardUnreachableContent(lastControl, null, 1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 270 });
  });

  it("leaves the ring to move on rather than scroll the selected control out of view", () => {
    const { lastControl, scrollBy } = scrollingPage({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
      controlTop: 0,
    });

    expect(scrollTowardUnreachableContent(lastControl, null, 1)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls no further than the end of the page", () => {
    const { lastControl, scrollBy } = scrollingPage({ scrollHeight: 1000, clientHeight: 400, scrollTop: 500 });

    expect(scrollTowardUnreachableContent(lastControl, null, 1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 100 });
  });

  it("leaves the ring to wrap once the page is at its end", () => {
    const { lastControl, scrollBy } = scrollingPage({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });

    expect(scrollTowardUnreachableContent(lastControl, null, 1)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("scrolls up toward content above the first control", () => {
    const { lastControl, scrollBy } = scrollingPage({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 200,
      controlTop: 10,
    });

    expect(scrollTowardUnreachableContent(lastControl, null, -1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: -200 });
  });

  it("scrolls up no further than keeps the first control above the bottom edge", () => {
    const { lastControl, scrollBy } = scrollingPage({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 500,
      controlTop: 10,
    });

    expect(scrollTowardUnreachableContent(lastControl, null, -1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: -370 });
  });

  it("scrolls inside a group only while part of the group is still out of view", () => {
    const { lastControl, scrollBy } = scrollingPage({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });

    expect(scrollTowardUnreachableContent(lastControl, group(100, 380), 1)).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTowardUnreachableContent(lastControl, group(100, 700), 1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 350 });
  });

  it("counts the part of a group under the keypad guidance bar as hidden", () => {
    const { lastControl, scrollBy } = scrollingPage({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
      controlTop: 370,
    });
    document.documentElement.style.setProperty("--keypad-guidance-reserved-height", "32px");

    // The group ends at 390 px: inside the 400 px page, but under the bar that covers 368-400.
    expect(scrollTowardUnreachableContent(lastControl, group(100, 390), 1)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 368 });
  });

  it("treats a stop outside the scrolling page, such as the tab bar, as leaving it", () => {
    const { page, lastControl } = scrollingPage({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    const sibling = document.createElement("button");
    page.append(sibling);
    const tabBar = document.createElement("button");
    document.body.append(tabBar);

    expect(leavesScrollContainer(lastControl, sibling)).toBe(false);
    expect(leavesScrollContainer(lastControl, tabBar)).toBe(true);
  });
});
