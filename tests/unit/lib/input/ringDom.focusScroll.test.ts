/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusRingElement } from "@/lib/input/ringDom";

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
