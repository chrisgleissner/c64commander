/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { stepFocusWithinOverlay } from "@/lib/input/ringDom";

/*
 * A dialog whose body scrolls and whose last control sits above the end of its text: Down on that
 * control used to wrap to the first control, so the text below could not be reached by keys.
 */
const dialogWithScrollingBody = (scrollTop: number) => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const body = document.createElement("div");
  body.style.overflowY = "auto";
  Object.defineProperty(body, "scrollHeight", { configurable: true, value: 900 });
  Object.defineProperty(body, "clientHeight", { configurable: true, value: 300 });
  body.scrollTop = scrollTop;
  body.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
  const scrollBy = vi.fn();
  body.scrollBy = scrollBy as unknown as typeof body.scrollBy;
  const first = document.createElement("button");
  first.textContent = "First";
  const last = document.createElement("button");
  last.textContent = "Last";
  const text = document.createElement("p");
  text.textContent = "Text below the last control";
  body.append(first, last, text);
  dialog.append(body);
  document.body.append(dialog);
  for (const button of [first, last]) {
    button.getBoundingClientRect = () =>
      ({ top: 10, bottom: 54, width: 100, height: 44, left: 0, right: 100 }) as DOMRect;
  }
  return { dialog, first, last, scrollBy };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("stepFocusWithinOverlay with a scrolling dialog body", () => {
  it("scrolls the body toward text below the last control instead of wrapping", () => {
    const { dialog, last, scrollBy } = dialogWithScrollingBody(0);
    last.focus();

    expect(stepFocusWithinOverlay(dialog, last, true)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 240 });
    expect(document.activeElement).toBe(last);
  });

  it("wraps to the first control once the body is at its end", () => {
    const { dialog, first, last, scrollBy } = dialogWithScrollingBody(600);
    last.focus();

    expect(stepFocusWithinOverlay(dialog, last, true)).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });
});
