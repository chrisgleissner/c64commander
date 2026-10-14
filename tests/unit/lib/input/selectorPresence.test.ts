/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectorPresence } from "@/lib/input/selectorPresence";
import { isAnyOverlayOpen, subscribeOverlayPresence } from "@/lib/input/eventTargets";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const documentWideQueries = () => {
  const counted = { count: 0 };
  const wrap = <T extends object>(proto: T, name: "querySelector" | "querySelectorAll") => {
    const original = (proto as Record<string, (...args: unknown[]) => unknown>)[name];
    return vi.spyOn(proto as never, name as never).mockImplementation(function (this: unknown, ...args: unknown[]) {
      if (this === document) counted.count += 1;
      return original.apply(this, args);
    } as never);
  };
  wrap(Document.prototype, "querySelector");
  wrap(Document.prototype, "querySelectorAll");
  return counted;
};

describe("selectorPresence", () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument("presence");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const presence = () => selectorPresence(doc, "[role='dialog'],[data-popper]", ["role", "data-popper"]);

  it("sees an element added and removed in the same task, before the observer callback runs", () => {
    const tracker = presence();
    expect(tracker.isPresent()).toBe(false);
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    doc.body.appendChild(dialog);
    expect(tracker.isPresent()).toBe(true);
    dialog.remove();
    expect(tracker.isPresent()).toBe(false);
  });

  it("sees a match nested inside an added subtree", () => {
    const tracker = presence();
    expect(tracker.isPresent()).toBe(false);
    const wrapper = doc.createElement("section");
    wrapper.innerHTML = "<div><span data-popper></span></div>";
    doc.body.appendChild(wrapper);
    expect(tracker.isPresent()).toBe(true);
    wrapper.querySelector("[data-popper]")!.remove();
    expect(tracker.isPresent()).toBe(false);
  });

  it("follows the tested attributes being set and cleared on an element already in the document", () => {
    const tracker = presence();
    const panel = doc.createElement("div");
    doc.body.appendChild(panel);
    expect(tracker.isPresent()).toBe(false);
    panel.setAttribute("role", "dialog");
    expect(tracker.isPresent()).toBe(true);
    panel.setAttribute("role", "region");
    expect(tracker.isPresent()).toBe(false);
  });

  it("ignores a tested attribute that takes a non-matching value or lands on a removed element", () => {
    const tracker = presence();
    const panel = doc.createElement("div");
    doc.body.appendChild(panel);
    expect(tracker.isPresent()).toBe(false);
    panel.setAttribute("role", "region");
    expect(tracker.isPresent()).toBe(false);
    panel.setAttribute("role", "dialog");
    panel.remove();
    expect(tracker.isPresent()).toBe(false);
  });

  it("notifies every subscriber of one change", async () => {
    const tracker = presence();
    const first = vi.fn();
    const second = vi.fn();
    tracker.subscribe(first);
    tracker.subscribe(second);
    doc.body.innerHTML = "<div data-popper></div>";
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stays present while a second match remains after the first is removed", () => {
    const tracker = presence();
    doc.body.innerHTML = "<div id='a' role='dialog'></div><div id='b' data-popper></div>";
    expect(tracker.isPresent()).toBe(true);
    doc.getElementById("a")!.remove();
    expect(tracker.isPresent()).toBe(true);
    doc.getElementById("b")!.remove();
    expect(tracker.isPresent()).toBe(false);
  });

  it("ignores an element that was added and removed before it was read", () => {
    const tracker = presence();
    expect(tracker.isPresent()).toBe(false);
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    doc.body.appendChild(dialog);
    doc.body.removeChild(dialog);
    expect(tracker.isPresent()).toBe(false);
  });

  it("sees a match moved out of a removed container into the document again", () => {
    const tracker = presence();
    const holder = doc.createElement("div");
    holder.innerHTML = "<div role='dialog'></div>";
    doc.body.appendChild(holder);
    expect(tracker.isPresent()).toBe(true);
    const dialog = holder.firstElementChild!;
    holder.remove();
    expect(tracker.isPresent()).toBe(false);
    doc.body.appendChild(dialog);
    expect(tracker.isPresent()).toBe(true);
  });

  it("notifies subscribers once per change, in a microtask, and not for unrelated mutations", async () => {
    const tracker = presence();
    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);
    doc.body.appendChild(doc.createElement("p"));
    await settle();
    expect(listener).not.toHaveBeenCalled();
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    doc.body.appendChild(dialog);
    expect(listener).not.toHaveBeenCalled();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    dialog.remove();
    expect(tracker.isPresent()).toBe(false);
    await settle();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    doc.body.appendChild(dialog);
    await settle();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("selectorPresence without MutationObserver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches the document on every read", () => {
    vi.stubGlobal("MutationObserver", undefined);
    const doc = document.implementation.createHTMLDocument("unobserved");
    const tracker = selectorPresence(doc, "[role='dialog']", ["role"]);
    const listener = vi.fn();
    tracker.subscribe(listener)();
    expect(tracker.isPresent()).toBe(false);
    doc.body.innerHTML = "<div role='dialog'></div>";
    expect(tracker.isPresent()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reports no overlay where there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(isAnyOverlayOpen()).toBe(false);
  });
});

describe("isAnyOverlayOpen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("answers repeated reads without searching the document while nothing has changed", () => {
    document.body.innerHTML = "<main><button>Play</button></main>";
    const main = document.body.firstElementChild!;
    expect(isAnyOverlayOpen()).toBe(false);
    const queries = documentWideQueries();
    for (let read = 0; read < 10; read += 1) expect(isAnyOverlayOpen()).toBe(false);
    main.setAttribute("data-key-selected", "true");
    main.firstElementChild!.textContent = "Stop";
    main.appendChild(document.createElement("span"));
    expect(isAnyOverlayOpen()).toBe(false);
    expect(queries.count).toBe(0);
  });

  it("sees an overlay that opens and closes between two reads", () => {
    document.body.innerHTML = "<main><button>Play</button></main>";
    expect(isAnyOverlayOpen()).toBe(false);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.appendChild(wrapper);
    expect(isAnyOverlayOpen()).toBe(true);
    wrapper.remove();
    expect(isAnyOverlayOpen()).toBe(false);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    expect(isAnyOverlayOpen()).toBe(true);
    menu.setAttribute("role", "group");
    expect(isAnyOverlayOpen()).toBe(false);
  });

  it("tells overlay-presence subscribers when an alert dialog opens and closes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOverlayPresence(listener);
    const alert = document.createElement("div");
    alert.setAttribute("role", "alertdialog");
    document.body.appendChild(alert);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    alert.remove();
    await settle();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
