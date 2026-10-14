/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { stepFocusWithinOverlay } from "@/lib/input/ringDom";

type Box = { scrollHeight: number; clientHeight: number; scrollTop: number };

const button = (label: string) => {
  const element = document.createElement("button");
  element.textContent = label;
  element.getBoundingClientRect = () =>
    ({ top: 10, bottom: 54, width: 100, height: 44, left: 0, right: 100 }) as DOMRect;
  return element;
};

const scrolling = ({ scrollHeight, clientHeight, scrollTop }: Box) => {
  const element = document.createElement("div");
  element.style.overflowY = "auto";
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
  element.scrollTop = scrollTop;
  element.getBoundingClientRect = () => ({ top: 0, bottom: clientHeight }) as DOMRect;
  const scrollBy = vi.fn();
  element.scrollBy = scrollBy as unknown as typeof element.scrollBy;
  return { element, scrollBy };
};

const text = () => {
  const paragraph = document.createElement("p");
  paragraph.textContent = "Text that follows the controls";
  return paragraph;
};

/** A dialog whose only controls sit in its scrolling body, with text after the last one. */
const dialogWithScrollingBody = (scrollTop: number, scrollHeight = 900) => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const body = scrolling({ scrollHeight, clientHeight: 300, scrollTop });
  const first = button("First");
  const last = button("Last");
  body.element.append(first, last, text());
  dialog.append(body.element);
  document.body.append(dialog);
  return { dialog, first, last, scrollBy: body.scrollBy };
};

/** The app's dialog and sheet layout: a scrolling body, then a footer of buttons outside it. */
const dialogWithFooter = (scrollTop: number) => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const body = scrolling({ scrollHeight: 900, clientHeight: 300, scrollTop });
  const option = button("Option");
  body.element.append(option, text());
  const footer = document.createElement("div");
  const save = button("Save");
  footer.append(save);
  dialog.append(body.element, footer);
  document.body.append(dialog);
  return { dialog, option, save, scrollBy: body.scrollBy };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("stepFocusWithinOverlay with a scrolling dialog body", () => {
  it("scrolls the body toward text below the last control instead of wrapping", () => {
    const { dialog, last, scrollBy } = dialogWithScrollingBody(0);
    last.focus();

    expect(stepFocusWithinOverlay(dialog, last, true)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 300 });
    expect(document.activeElement).toBe(last);
  });

  it("wraps to the first control once the body is at its end", () => {
    const { dialog, first, last, scrollBy } = dialogWithScrollingBody(600);
    last.focus();

    expect(stepFocusWithinOverlay(dialog, last, true)).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it("scrolls the body before Down moves on to a footer button outside it", () => {
    const { dialog, option, scrollBy } = dialogWithFooter(0);
    option.focus();

    stepFocusWithinOverlay(dialog, option, true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 300 });
    expect(document.activeElement).toBe(option);
  });

  it("moves on to the footer once the body is at its end", () => {
    const { dialog, option, save, scrollBy } = dialogWithFooter(600);
    option.focus();

    stepFocusWithinOverlay(dialog, option, true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(save);
  });

  it("scrolls the body up toward content above the first control before Up wraps", () => {
    const { dialog, first, scrollBy } = dialogWithScrollingBody(300);
    first.focus();

    stepFocusWithinOverlay(dialog, first, false);
    expect(scrollBy).toHaveBeenCalledWith({ top: -300 });
    expect(document.activeElement).toBe(first);
  });

  it("treats less than a control's height left as the body's padding, and moves on", () => {
    const { dialog, first, last, scrollBy } = dialogWithScrollingBody(0, 324);
    last.focus();

    stepFocusWithinOverlay(dialog, last, true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it("never scrolls the page behind the dialog", () => {
    const page = scrolling({ scrollHeight: 2000, clientHeight: 400, scrollTop: 0 });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const first = button("First");
    const last = button("Last");
    dialog.append(first, last);
    page.element.append(dialog);
    document.body.append(page.element);
    last.focus();

    stepFocusWithinOverlay(dialog, last, true);
    expect(page.scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });
});
