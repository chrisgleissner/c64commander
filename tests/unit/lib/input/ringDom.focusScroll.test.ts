/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusRingElement, revealRingElementAfterLayout } from "@/lib/input/ringDom";

const WINDOW_HEIGHT = 426;
const APP_BAR_BOTTOM = 49;
const TAB_BAR_TOP = 376;

let originalInnerHeight: number;

beforeEach(() => {
  originalInnerHeight = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: WINDOW_HEIGHT });
});

afterEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  document.body.replaceChildren();
});

/** A page that scrolls in its own container between the app bar and the tab bar, as Settings does. */
const pageShellWithCard = (card: { top: number; height: number }) => {
  const shell = document.createElement("div");
  shell.style.overflowY = "auto";
  Object.defineProperty(shell, "scrollHeight", { value: 2000 });
  Object.defineProperty(shell, "clientHeight", { value: TAB_BAR_TOP - APP_BAR_BOTTOM });
  shell.getBoundingClientRect = () => ({ top: APP_BAR_BOTTOM, bottom: TAB_BAR_TOP }) as DOMRect;
  const element = document.createElement("button");
  element.getBoundingClientRect = () =>
    ({ top: card.top, bottom: card.top + card.height, height: card.height }) as DOMRect;
  const scrollIntoView = vi.fn();
  element.scrollIntoView = scrollIntoView;
  shell.append(element);
  document.body.append(shell);
  return { element, scrollIntoView };
};

describe("focusRingElement", () => {
  it("aligns the start of a card taller than its scroll container, though the card fits the window", () => {
    // 340 px fits the 426 px window but not the 327 px container. Aligned by its end, the card's
    // top would sit 13 px above the container, under the app bar.
    const { element, scrollIntoView } = pageShellWithCard({ top: 600, height: 340 });

    focusRingElement(element);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
  });

  it("aligns the end of a card that fits its scroll container but ends under the tab bar", () => {
    // Ends at 400 px: inside the 426 px window, so judged against the window it looked whole and
    // was left with its last 24 px under the tab bar.
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 200 });

    focusRingElement(element);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", inline: "nearest" });
  });
});

describe("revealRingElementAfterLayout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("scrolls the element back into view when a layout change moved it below the scroll container", () => {
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    scrollIntoView.mockClear();
    element.getBoundingClientRect = () => ({ top: 463, bottom: 511, height: 48 }) as DOMRect;

    revealRingElementAfterLayout(element);
    vi.advanceTimersByTime(500);

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("leaves an element that is still on screen alone", () => {
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    scrollIntoView.mockClear();

    revealRingElementAfterLayout(element);
    vi.advanceTimersByTime(500);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing once cancelled", () => {
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    scrollIntoView.mockClear();
    element.getBoundingClientRect = () => ({ top: 463, bottom: 511, height: 48 }) as DOMRect;

    revealRingElementAfterLayout(element)();
    vi.advanceTimersByTime(500);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it("reveals the element when the layout changes after the timed checks, as a late size change does", async () => {
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    revealRingElementAfterLayout(element);
    vi.advanceTimersByTime(1000);
    scrollIntoView.mockClear();

    element.getBoundingClientRect = () => ({ top: 403, bottom: 451, height: 48 }) as DOMRect;
    element.parentElement!.append(document.createElement("span"));
    await Promise.resolve();

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("reveals the ring's current element when the pressed one was replaced during the watch", async () => {
    const { element } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    revealRingElementAfterLayout(element);
    const replacement = document.createElement("button");
    replacement.getBoundingClientRect = () => ({ top: 403, bottom: 451, height: 48 }) as DOMRect;
    const replacementScroll = vi.fn();
    replacement.scrollIntoView = replacementScroll;

    element.replaceWith(replacement);
    focusRingElement(replacement);
    replacementScroll.mockClear();
    await Promise.resolve();

    expect(replacementScroll).toHaveBeenCalled();
  });

  it("stops watching at the next key press", async () => {
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    revealRingElementAfterLayout(element);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    scrollIntoView.mockClear();

    element.getBoundingClientRect = () => ({ top: 403, bottom: 451, height: 48 }) as DOMRect;
    element.parentElement!.append(document.createElement("span"));
    await Promise.resolve();
    vi.advanceTimersByTime(2000);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("stops watching after the watch window", async () => {
    const { element, scrollIntoView } = pageShellWithCard({ top: 200, height: 40 });
    focusRingElement(element);
    revealRingElementAfterLayout(element);
    vi.advanceTimersByTime(2000);
    scrollIntoView.mockClear();

    element.getBoundingClientRect = () => ({ top: 403, bottom: 451, height: 48 }) as DOMRect;
    element.parentElement!.append(document.createElement("span"));
    await Promise.resolve();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
